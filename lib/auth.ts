import { cookies } from 'next/headers';
import { ZodError } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import type { PlanKey } from './plans';

const COOKIE = 'yanki_session';
const TTL_DAYS = 30;

/** Only the hash is stored, so a database dump cannot be replayed as a login. */
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export interface Session {
  userId: string;
  email: string;
  fullName: string | null;
  locale: 'tr' | 'en';
  orgId: string;
  orgName: string;
  plan: PlanKey;
  trialEndsAt: string;
  role: 'owner' | 'analyst' | 'client';
}

export async function createSession(userId: string, meta: { ua?: string; ip?: string } = {}) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TTL_DAYS * 86_400_000);

  await sql`
    insert into sessions (token_hash, user_id, expires_at, user_agent, ip)
    values (${hashToken(token)}, ${userId}, ${expires}, ${meta.ua ?? null}, ${meta.ip ?? null})`;

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sql`delete from sessions where token_hash = ${hashToken(token)}`;
  jar.delete(COOKIE);
}

/** Returns null rather than throwing, so public routes can call it freely. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const rows = await sql`
    select u.id as user_id, u.email, u.full_name, u.locale,
           o.id as org_id, o.name as org_name, o.plan, o.trial_ends_at,
           m.role
      from sessions s
      join users u on u.id = s.user_id
      join memberships m on m.user_id = u.id
      join organizations o on o.id = m.org_id
     where s.token_hash = ${hashToken(token)}
       and s.expires_at > now()
     limit 1`;
  if (!rows.length) return null;

  const r = rows[0];
  return {
    userId: r.user_id, email: r.email, fullName: r.full_name,
    locale: (r.locale === 'en' ? 'en' : 'tr'),
    orgId: r.org_id, orgName: r.org_name, plan: r.plan,
    trialEndsAt: r.trial_ends_at, role: r.role,
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'Not signed in');
  return s;
}

/**
 * Ownership check on every handler that accepts a workspace id from the
 * client. This is the primary defence; do not rely on the UI hiding things.
 */
export async function requireWorkspace(session: Session, workspaceId: string) {
  const rows = await sql`
    select * from workspaces where id = ${workspaceId} and org_id = ${session.orgId} limit 1`;
  if (!rows.length) throw new HttpError(404, 'Workspace not found');
  return rows[0];
}

/** Wraps a handler so thrown HttpErrors become clean JSON responses. */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) {
        return Response.json({ error: e.message }, { status: e.status });
      }
      // A validation failure is the caller's problem, not ours. Returning 500
      // here would tell the user "server error" for a typo and would hide real
      // faults in the logs behind a wall of bad input.
      if (e instanceof ZodError) {
        const first = e.errors[0];
        const where = first?.path?.join('.') || 'request';
        return Response.json({ error: `Invalid ${where}: ${first?.message ?? 'bad value'}` }, { status: 400 });
      }
      if (e instanceof SyntaxError) {
        return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
      }
      const msg = e instanceof Error ? e.message : 'Unexpected error';
      // Never leak a stack or a connection string to the client.
      console.error('[api]', msg, e instanceof Error ? e.stack : '');
      return Response.json({ error: 'Server error' }, { status: 500 });
    }
  };
}

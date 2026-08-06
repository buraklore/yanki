import { z } from 'zod';
import { sql } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { createSession, handler, HttpError } from '@/lib/auth';
import { enforce, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export const POST = handler(async (req) => {
  // Rate limit before touching the database: an unlimited login endpoint is a
  // password oracle, and scrypt makes each attempt expensive for us too.
  await enforce('login', clientIp(req));
  const { email, password } = Body.parse(await req.json());

  const rows = await sql`select id, password_hash from users where email = ${email}`;
  // Same message and roughly the same work either way, so the response cannot
  // be used to enumerate which addresses have accounts.
  const stored = rows[0]?.password_hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
  const ok = await verifyPassword(password, stored);
  if (!rows.length || !ok) throw new HttpError(401, 'Email or password is incorrect.');

  await sql`update users set last_login_at = now() where id = ${rows[0].id}`;
  await createSession(rows[0].id, {
    ua: req.headers.get('user-agent') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
  });
  return Response.json({ ok: true });
});

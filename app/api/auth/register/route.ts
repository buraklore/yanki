import { z } from 'zod';
import { sql } from '@/lib/db';
import { hashPassword, passwordProblem } from '@/lib/password';
import { createSession, handler, HttpError } from '@/lib/auth';
import { enforce, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const Body = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  fullName: z.string().max(120).optional(),
  orgName: z.string().max(120).optional(),
});

export const POST = handler(async (req) => {
  // Each new account gets a trial that spends provider credits. Without a cap
  // one script can turn our API bill into someone else's afternoon.
  await enforce('register', clientIp(req));
  const body = Body.parse(await req.json());
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, problem);

  const existing = await sql`select 1 from users where email = ${body.email}`;
  if (existing.length) throw new HttpError(409, 'An account with this email already exists.');

  const hash = await hashPassword(body.password);

  // One transaction: a half-created account with no organisation would leave
  // the user permanently stuck on the onboarding screen.
  const [user] = await sql.begin(async (tx: typeof sql) => {
    const [u] = await tx`
      insert into users (email, password_hash, full_name)
      values (${body.email}, ${hash}, ${body.fullName ?? null})
      returning id, email`;
    const [o] = await tx`
      insert into organizations (name, kind, plan)
      values (${body.orgName || body.fullName || body.email.split('@')[0]}, 'brand', 'trial')
      returning id`;
    await tx`insert into memberships (org_id, user_id, role) values (${o.id}, ${u.id}, 'owner')`;
    return [u];
  }) as [{ id: string; email: string }];

  await createSession(user.id, {
    ua: req.headers.get('user-agent') ?? undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
  });
  return Response.json({ ok: true, email: user.email });
});

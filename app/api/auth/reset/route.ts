import { z } from 'zod';
import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { handler, HttpError, createSession } from '@/lib/auth';
import { hashPassword, passwordProblem } from '@/lib/password';
import { enforce, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const Body = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) });

export const POST = handler(async (req) => {
  await enforce('login', clientIp(req));
  const { token, password } = Body.parse(await req.json());

  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);

  const hash = createHash('sha256').update(token).digest('hex');
  const [row] = await sql`
    select user_id from password_resets
     where token_hash = ${hash} and used_at is null and expires_at > now()`;
  if (!row) throw new HttpError(400, 'This reset link has expired or has already been used.');

  await sql.begin(async (tx: typeof sql) => {
    await tx`update users set password_hash = ${await hashPassword(password)} where id = ${row.user_id}`;
    await tx`update password_resets set used_at = now() where token_hash = ${hash}`;
    // Every existing session dies: if the password was reset because someone
    // else had it, leaving their session alive defeats the whole exercise.
    await tx`delete from sessions where user_id = ${row.user_id}`;
  });

  await createSession(row.user_id);
  return Response.json({ ok: true });
});

import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, handler, HttpError } from '@/lib/auth';
import { hashPassword, verifyPassword, passwordProblem } from '@/lib/password';

export const dynamic = 'force-dynamic';

const Body = z.object({ current: z.string().min(1), next: z.string().min(1).max(200) });

/** Change password while signed in. Requires the current one. */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const { current, next } = Body.parse(await req.json());

  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem);

  const [user] = await sql`select password_hash from users where id = ${s.userId}`;
  if (!await verifyPassword(current, user.password_hash)) {
    throw new HttpError(400, 'Your current password is not correct.');
  }

  await sql`update users set password_hash = ${await hashPassword(next)} where id = ${s.userId}`;
  // Other devices are signed out; this session stays alive.
  await sql`delete from sessions where user_id = ${s.userId} and token_hash <> (
    select token_hash from sessions where user_id = ${s.userId} order by created_at desc limit 1)`;
  return Response.json({ ok: true });
});

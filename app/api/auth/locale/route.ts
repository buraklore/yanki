import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, handler } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const Body = z.object({ locale: z.enum(['tr', 'en']) });

/**
 * Interface language, stored on the user rather than in the browser so it
 * follows them to a second device and survives a cleared cache.
 */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const { locale } = Body.parse(await req.json());
  await sql`update users set locale = ${locale} where id = ${s.userId}`;
  return Response.json({ ok: true, locale });
});

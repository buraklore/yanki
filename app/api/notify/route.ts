import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, handler } from '@/lib/auth';
import { mailerConfigured } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

const Body = z.object({
  weekly: z.boolean().optional(),
  alerts: z.boolean().optional(),
});

/** Notification preferences. Defaults are on; silence loses customers. */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Body.parse(await req.json());
  if (b.weekly !== undefined) {
    await sql`update users set notify_weekly = ${b.weekly} where id = ${s.userId}`;
  }
  if (b.alerts !== undefined) {
    await sql`update users set notify_alerts = ${b.alerts} where id = ${s.userId}`;
  }
  const [u] = await sql`select notify_weekly, notify_alerts from users where id = ${s.userId}`;
  return Response.json({
    ok: true,
    weekly: u.notify_weekly, alerts: u.notify_alerts,
    mailerConfigured: mailerConfigured(),
  });
});

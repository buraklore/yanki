import { sql } from '@/lib/db';
import { getSession, handler } from '@/lib/auth';
import { limits } from '@/lib/plans';

export const dynamic = 'force-dynamic';

/** Bootstrap call: who am I, what plan, which workspace should I open. */
export const GET = handler(async () => {
  const s = await getSession();
  if (!s) return Response.json({ signedIn: false });

  const workspaces = await sql`
    select id, brand_name, domain, sector, onboarded
      from workspaces where org_id = ${s.orgId} order by created_at limit 25`;

  // Preferences travel with the bootstrap so Settings renders without a second
  // round trip and the toggles are never briefly wrong.
  const [prefs] = await sql`select notify_weekly, notify_alerts from users where id = ${s.userId}`;
  const notify = {
    weekly: prefs?.notify_weekly !== false,
    alerts: prefs?.notify_alerts !== false,
    mailerConfigured: !!process.env.RESEND_API_KEY,
  };

  return Response.json({
    signedIn: true,
    user: { email: s.email, fullName: s.fullName, locale: s.locale, notify },
    org: { id: s.orgId, name: s.orgName, plan: s.plan, trialEndsAt: s.trialEndsAt },
    limits: limits(s.plan),
    role: s.role,
    workspaces,
  });
});

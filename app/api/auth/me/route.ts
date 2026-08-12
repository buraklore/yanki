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
  const [prefs] = await sql`
    select notify_weekly, notify_alerts, is_admin from users where id = ${s.userId}`;
  const notify = {
    weekly: prefs?.notify_weekly !== false,
    alerts: prefs?.notify_alerts !== false,
    mailerConfigured: !!process.env.RESEND_API_KEY,
  };

  /**
   * Real consumption, for the usage bars on the billing screen.
   *
   * Those bars used to be written by hand — "GEO Audits 1", "Content Writer 0"
   * — so a customer at their monthly audit limit still saw 1/10 and had no
   * warning before the next run was refused. Counts are org-wide because the
   * caps are, and audits are counted for the current calendar month because
   * that is the window /api/audit enforces.
   */
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const period = monthStart.toISOString().slice(0, 10);

  const [usageRow] = await sql`
    select
      (select count(*)::int from prompts p
         join workspaces w on w.id = p.workspace_id
        where w.org_id = ${s.orgId} and p.active)                        as prompts,
      (select count(*)::int from competitors c
         join workspaces w on w.id = c.workspace_id
        where w.org_id = ${s.orgId} and c.active)                        as competitors,
      (select count(*)::int from workspaces where org_id = ${s.orgId})   as workspaces,
      (select coalesce(used, 0) from usage_counters
        where org_id = ${s.orgId} and period = ${period} and metric = 'audits') as audits`;

  const usage = {
    prompts: usageRow?.prompts ?? 0,
    competitors: usageRow?.competitors ?? 0,
    workspaces: usageRow?.workspaces ?? 0,
    audits: usageRow?.audits ?? 0,
    period,
  };

  return Response.json({
    signedIn: true,
    user: { email: s.email, fullName: s.fullName, locale: s.locale, notify },
    org: { id: s.orgId, name: s.orgName, plan: s.plan, trialEndsAt: s.trialEndsAt },
    limits: limits(s.plan),
    usage,
    role: s.role,
    /**
     * Platform operator, not organisation owner — every customer owns their own
     * org. This flag gates the diagnostics: which provider keys are missing,
     * which returned 429, whether the adjudication model ran. Those describe
     * our infrastructure, and a customer who cannot fix them should not be
     * asked to read them.
     */
    isAdmin: prefs?.is_admin === true,
    workspaces,
  });
});

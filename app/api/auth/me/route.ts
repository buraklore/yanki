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

  return Response.json({
    signedIn: true,
    user: { email: s.email, fullName: s.fullName },
    org: { id: s.orgId, name: s.orgName, plan: s.plan, trialEndsAt: s.trialEndsAt },
    limits: limits(s.plan),
    role: s.role,
    workspaces,
  });
});

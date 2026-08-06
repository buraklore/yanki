import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { limits, type PlanKey } from '@/lib/plans';
import { runAudit } from '@/lib/audit';
import { BlockedTargetError } from '@/lib/safe-fetch';
import { enforce } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  workspaceId: z.string().uuid(),
  url: z.string().max(300).optional(),
});

/**
 * Runs the 58-factor GEO audit against a live URL. Deterministic HTTP and HTML
 * parsing only — no model calls — so it costs nothing and can be re-run freely
 * within the plan's monthly allowance.
 */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Body.parse(await req.json());
  const ws = await requireWorkspace(s, b.workspaceId);
  await enforce('audit', s.orgId);

  const period = new Date();
  period.setUTCDate(1);
  const monthStart = period.toISOString().slice(0, 10);
  const cap = limits(s.plan as PlanKey).auditsPerMonth;

  const [used] = await sql`
    select used from usage_counters
     where org_id = ${s.orgId} and period = ${monthStart} and metric = 'audits'`;
  if ((used?.used ?? 0) >= cap) {
    throw new HttpError(402, `Your plan allows ${cap} audits per month.`);
  }

  const target = b.url?.trim() || ws.domain;
  let result;
  try {
    result = await runAudit(target, ws.brand_name);
  } catch (e) {
    if (e instanceof BlockedTargetError) throw new HttpError(400, e.message);
    throw new HttpError(400, `Could not reach ${target}. ${(e as Error).message.slice(0, 120)}`);
  }

  const [audit] = await sql`
    insert into audits (workspace_id, url, total_score, meta)
    values (${b.workspaceId}, ${result.url}, ${result.score.toFixed(2)}, ${sql.json(result.fetched)})
    returning id`;

  await sql`insert into audit_factors ${sql(result.factors.map(f => ({
    audit_id: audit.id, factor_key: f.key, category: f.category,
    label: f.label, status: f.status, detail: f.detail, fix: f.fix ?? null,
  })))} on conflict do nothing`;

  await sql`
    insert into usage_counters (org_id, period, metric, used)
    values (${s.orgId}, ${monthStart}, 'audits', 1)
    on conflict (org_id, period, metric) do update set used = usage_counters.used + 1`;

  return Response.json({
    id: audit.id,
    url: result.url,
    score: result.score,
    fetched: result.fetched,
    categories: result.categories,
    remaining: cap - ((used?.used ?? 0) + 1),
  });
});

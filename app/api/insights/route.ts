import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { platformAdvice } from '@/lib/platform-advice';
import { engineByKey } from '@/lib/engines';
import { PLAN_RANK, type PlanKey } from '@/lib/plans';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Per-platform diagnosis and advice.
 *
 * Separate from /api/results so the dashboard stays fast: this does a handful
 * of aggregate queries that only the Action Plan screen needs.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') ?? '';
  await requireWorkspace(s, workspaceId);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days') ?? 30)));

  const rows = await sql`select key, label, default_weight, min_plan from engines order by sort_order`;
  const engines = rows.map((e: { key: string; label: string; default_weight: string; min_plan: PlanKey }) => ({
    key: e.key,
    label: e.label,
    weight: Number(e.default_weight),
    measured: PLAN_RANK[s.plan as PlanKey] >= PLAN_RANK[e.min_plan] && !!engineByKey(e.key)?.enabled(),
  }));

  const advice = await platformAdvice(workspaceId, engines, days);
  return Response.json({ platforms: advice });
});

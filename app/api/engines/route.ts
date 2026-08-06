import { sql } from '@/lib/db';
import { requireSession, handler } from '@/lib/auth';
import { ENGINES, engineByKey } from '@/lib/engines';
import { PLAN_RANK, type PlanKey } from '@/lib/plans';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Engine status for the Settings screen: which providers have a key, which
 * are gated by the plan, and — on demand — whether the key actually works.
 * Without this, a wrong key or a retired model name shows up as an
 * unexplained zero in the score three hours later.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const probe = new URL(req.url).searchParams.get('test') === '1';

  const rows = await sql`select key, label, default_weight, min_plan, method from engines order by sort_order`;

  const results = await Promise.all(rows.map(async (r: {
    key: string; label: string; default_weight: string; min_plan: PlanKey; method: string;
  }) => {
    const engine = engineByKey(r.key);
    const configured = !!engine?.enabled();
    const planOk = PLAN_RANK[s.plan as PlanKey] >= PLAN_RANK[r.min_plan];

    const base = {
      key: r.key, label: r.label, weight: Number(r.default_weight), method: r.method,
      minPlan: r.min_plan, planOk, configured,
      envKey: engine?.envKey ?? null,
      model: engine ? (process.env[engine.modelEnvKey] || engine.defaultModel) : null,
    };

    // Only owners can burn provider credits on a live probe.
    if (!probe || !configured || s.role !== 'owner') return base;
    return { ...base, test: await engine!.test() };
  }));

  return Response.json({
    plan: s.plan,
    mock: process.env.MOCK_ENGINES === '1',
    engines: results,
    // The scan is only meaningful if at least one engine can actually answer.
    ready: results.some(e => e.configured && e.planOk),
  });
});

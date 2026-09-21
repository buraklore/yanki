import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { enforce } from '@/lib/rate-limit';
import { PLAN_RANK, type PlanKey } from '@/lib/plans';
import { enabledEngines } from '@/lib/engines';
import { ENGINE_WEIGHT } from '@/lib/score';
import { drainJobs } from '@/lib/scan';
import { generateVariants, variantReport, VARIANT_ENGINES, type VariantCell } from '@/lib/variants';
import { llmAvailable } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * prompts/variants — phrasing robustness for one tracked query (fan-out).
 *
 * Cost shape, stated up front because it is the design constraint: one press
 * is up to 6 variants × 4 engines × 1 run ≈ 24 provider calls plus the judge.
 * That is why this is Growth+ only, rate-limited, and on-demand rather than
 * part of the nightly scan.
 *
 * Variants are prompt rows (source='variant', active=false, parent_id), so
 * they ride the existing scan_jobs queue and SKIP LOCKED semantics; jobs are
 * attached to today's scan row without touching its status, and the rollup
 * excludes variant runs, so the visibility score never moves because a test
 * was pressed.
 */

async function allowedEngineKeys(plan: PlanKey): Promise<string[]> {
  const rows = await sql`select key, min_plan from engines`;
  const enabled = enabledEngines().map(e => e.key);
  return rows
    .filter((e: { key: string; min_plan: PlanKey }) => PLAN_RANK[plan] >= PLAN_RANK[e.min_plan])
    .map((e: { key: string }) => e.key as string)
    .filter((k: string) => enabled.includes(k))
    .sort((a: string, b: string) => (ENGINE_WEIGHT[b] ?? 0) - (ENGINE_WEIGHT[a] ?? 0))
    .slice(0, VARIANT_ENGINES);
}

/** Today's scan row, without disturbing its status or timestamps. */
async function todaysScan(workspaceId: string) {
  const [scan] = await sql`
    insert into scans (workspace_id, scan_date, status, runs_target, finished_at)
    values (${workspaceId}, current_date, 'done', 1, now())
    on conflict (workspace_id, scan_date) do update
      set workspace_id = excluded.workspace_id
    returning id`;
  return scan.id as string;
}

const Start = z.object({
  workspaceId: z.string().uuid(),
  promptId: z.string().uuid(),
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Start.parse(await req.json());
  const ws = await requireWorkspace(s, b.workspaceId);

  const plan = s.plan as PlanKey;
  if (PLAN_RANK[plan] < PLAN_RANK.growth) {
    throw new HttpError(402, 'Variant testing is available on Growth and above.');
  }
  await enforce('variants', s.orgId);

  const [parent] = await sql`
    select id, text, intent, language, country_code from prompts
     where id = ${b.promptId} and workspace_id = ${b.workspaceId}
       and coalesce(source, '') <> 'variant'`;
  if (!parent) throw new HttpError(404, 'Prompt not found');

  const engines = await allowedEngineKeys(plan);
  if (!engines.length) throw new HttpError(503, 'No engine is configured for measurement.');

  // Existing variants are reused across presses: the phrasings are the
  // experiment's fixed arms, and regenerating them each time would make two
  // reports incomparable.
  let variants = await sql`
    select id, text from prompts
     where parent_id = ${parent.id} and workspace_id = ${b.workspaceId}
       and source = 'variant'`;

  if (variants.length === 0) {
    if (!llmAvailable()) {
      throw new HttpError(503,
        'Variant generation needs a utility model (ANTHROPIC / OPENAI / GOOGLE key).');
    }
    const texts = await generateVariants(parent.text, ws.language);
    if (!texts || !texts.length) {
      throw new HttpError(502, 'The model produced no usable variants. Try again.');
    }
    const rows = texts.map(text => ({
      workspace_id: b.workspaceId, text,
      intent: parent.intent, volume: 0, source: 'variant', active: false,
      parent_id: parent.id,
      language: parent.language ?? null, country_code: parent.country_code ?? null,
    }));
    await sql`insert into prompts ${sql(rows)} on conflict (workspace_id, text) do nothing`;
    variants = await sql`
      select id, text from prompts
       where parent_id = ${parent.id} and workspace_id = ${b.workspaceId}
         and source = 'variant'`;
  }
  if (!variants.length) throw new HttpError(502, 'No variants available.');

  const scanId = await todaysScan(b.workspaceId);
  const jobs = variants.flatMap((v: { id: string }) =>
    engines.map(engineKey => ({
      scan_id: scanId, workspace_id: b.workspaceId,
      prompt_id: v.id, engine_key: engineKey, run_index: 0,
    })));
  await sql`insert into scan_jobs ${sql(jobs)} on conflict do nothing`;
  // A repeat press means "measure again now": reset this test's jobs the same
  // way Rescan does. Answers upsert on their unique key, so no duplication.
  await sql`
    update scan_jobs set done_at = null, attempts = 0, error = null, locked_until = null
     where scan_id = ${scanId} and run_index = 0
       and prompt_id in ${sql(variants.map((v: { id: string }) => v.id))}`;

  // Warm start: most of a 24-job test finishes inside this invocation; the
  // GET below and the panel's normal polling drain any remainder.
  let drained = null;
  try { drained = await drainJobs(12, 35_000); } catch { /* queued regardless */ }

  return Response.json({
    started: true,
    variants: variants.length,
    engines,
    queued: jobs.length,
    drained,
  });
});

export const GET = handler(async (req) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') ?? '';
  const promptId = url.searchParams.get('prompt') ?? '';
  await requireWorkspace(s, workspaceId);

  const variants = await sql`
    select id, text from prompts
     where parent_id = ${promptId} and workspace_id = ${workspaceId}
       and source = 'variant'
     order by created_at`;
  if (!variants.length) {
    return Response.json({
      variants: [], cells: [], pending: 0,
      available: PLAN_RANK[s.plan as PlanKey] >= PLAN_RANK.growth,
    });
  }
  const ids = variants.map((v: { id: string }) => v.id);

  let [{ n: pending }] = await sql`
    select count(*)::int as n from scan_jobs
     where prompt_id in ${sql(ids)} and done_at is null and attempts < 4`;
  if (pending > 0) {
    // Same pattern as the dashboard: an open panel moves the queue along.
    try { await drainJobs(6, 12_000); } catch { /* best effort */ }
    [{ n: pending }] = await sql`
      select count(*)::int as n from scan_jobs
       where prompt_id in ${sql(ids)} and done_at is null and attempts < 4`;
  }

  // Latest answer per (variant, engine).
  const rows = await sql`
    select distinct on (ar.prompt_id, ar.engine_key)
           ar.prompt_id, ar.engine_key, ar.mentioned, ar.rank, ar.rank_kind, ar.asked_at
      from answer_runs ar
     where ar.prompt_id in ${sql(ids)} and ar.workspace_id = ${workspaceId}
     order by ar.prompt_id, ar.engine_key, ar.asked_at desc`;

  const cells: VariantCell[] = rows.map((r: {
    prompt_id: string; engine_key: string; mentioned: boolean | null; rank: number | null;
  }) => ({
    variantId: r.prompt_id, engineKey: r.engine_key,
    mentioned: r.mentioned === true, rank: r.rank === null ? null : Number(r.rank),
  }));

  return Response.json({
    variants,
    cells: rows.map((r: Record<string, unknown>) => ({
      variantId: r.prompt_id, engineKey: r.engine_key,
      mentioned: r.mentioned === true,
      rank: r.rank === null ? null : Number(r.rank),
      rankKind: r.rank_kind ?? null,
    })),
    pending,
    report: variantReport(cells),
    available: true,
  });
});

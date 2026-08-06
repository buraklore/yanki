import { sql } from './db';
import { engineByKey, enabledEngines, type Engine } from './engines';
import { extract, type BrandRef } from './extract';
import { scoreCell, aggregate, shareOfVoice, type Cell, type Run } from './score';
import { PLAN_RANK, limits, type PlanKey } from './plans';

/**
 * A daily scan is prompts × engines × runs. For a Growth workspace that is
 * 150 × 8 × 5 = 6,000 provider calls, which cannot run inside one serverless
 * invocation. We decompose it into rows in `scan_jobs` and drain the queue a
 * batch at a time — from Vercel Cron in production, or from a long-lived
 * worker on a VPS. Same function, different trigger.
 */

/** Informational prompts are cheap to be late on; commercial ones are not. */
function dueToday(intent: string, date = new Date()): boolean {
  if (intent === 'informational') return date.getUTCDay() === 1; // Mondays
  return true;
}

export interface EnqueueResult {
  scanId: string;
  jobs: number;
  engines: string[];
  skipped?: string;
}

export async function enqueueScan(
  workspaceId: string,
  opts: { runs?: number; force?: boolean } = {},
): Promise<EnqueueResult> {
  const [ws] = await sql`
    select w.*, o.plan from workspaces w
      join organizations o on o.id = w.org_id
     where w.id = ${workspaceId}`;
  if (!ws) throw new Error('workspace not found');

  const plan = ws.plan as PlanKey;
  const runsTarget = Math.min(opts.runs ?? limits(plan).runs, 5);

  const available = enabledEngines();
  if (!available.length) {
    return { scanId: '', jobs: 0, engines: [], skipped: 'no_engine_keys' };
  }

  const [scan] = await sql`
    insert into scans (workspace_id, scan_date, status, runs_target)
    values (${workspaceId}, current_date, 'queued', ${runsTarget})
    on conflict (workspace_id, scan_date) do update
      set status = 'queued', error = null, started_at = now(), finished_at = null
    returning *`;

  const prompts = await sql`
    select id, intent from prompts where workspace_id = ${workspaceId} and active`;
  const engineRows = await sql`select key, min_plan from engines`;

  const allowed = engineRows
    .filter((e: { key: string; min_plan: PlanKey }) => PLAN_RANK[plan] >= PLAN_RANK[e.min_plan])
    .filter((e: { key: string }) => available.some((x: Engine) => x.key === e.key))
    .map((e: { key: string }) => e.key as string);

  const rows: Record<string, unknown>[] = [];
  for (const p of prompts) {
    if (!opts.force && !dueToday(p.intent)) continue;
    for (const key of allowed) {
      // Enqueue three runs; the worker adds runs 4–5 only if the first three
      // disagree. See maybeExtendRuns.
      for (let i = 0; i < Math.min(3, runsTarget); i++) {
        rows.push({ scan_id: scan.id, workspace_id: workspaceId, prompt_id: p.id, engine_key: key, run_index: i });
      }
    }
  }

  if (rows.length) {
    await sql`insert into scan_jobs ${sql(rows)} on conflict do nothing`;
    await sql`update scans set queued_jobs = ${rows.length}, status = 'running' where id = ${scan.id}`;
  } else {
    await sql`update scans set status = 'done', finished_at = now() where id = ${scan.id}`;
  }

  return { scanId: scan.id, jobs: rows.length, engines: allowed };
}

/* ------------------------------------------------------------------ */

export interface DrainResult { claimed: number; ok: number; failed: number; finalised: number }

export async function drainJobs(batch = 20, budgetMs = 45_000): Promise<DrainResult> {
  const started = Date.now();
  const jobs = await sql`select * from claim_jobs(${batch})`;
  let ok = 0, failed = 0;

  // Bounded concurrency: providers rate-limit, and a serverless function has
  // a hard wall-clock ceiling we must respect.
  const LANES = 5;
  const queue = jobs.map(j => j as unknown as Job);
  await Promise.all(Array.from({ length: LANES }, async () => {
    for (;;) {
      const job = queue.shift();
      if (!job || Date.now() - started > budgetMs) return;
      try {
        await runJob(job);
        await sql`update scan_jobs set done_at = now(), error = null where id = ${job.id}`;
        ok++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await sql`update scan_jobs
             set error = ${msg.slice(0, 400)}, locked_until = now() + interval '60 seconds'
           where id = ${job.id}`;
      }
    }
  }));

  const finished = await sql`
    select s.id, s.workspace_id from scans s
     where s.status in ('queued','running')
       and not exists (select 1 from scan_jobs j where j.scan_id = s.id and j.done_at is null and j.attempts < 4)`;
  for (const s of finished) await rollUp(s.id, s.workspace_id);

  return { claimed: jobs.length, ok, failed, finalised: finished.length };
}

interface Job {
  id: number; scan_id: string; workspace_id: string; prompt_id: string;
  engine_key: string; run_index: number;
}

async function runJob(job: Job) {
  const engine = engineByKey(job.engine_key);
  if (!engine) throw new Error(`unknown engine ${job.engine_key}`);

  const [ws] = await sql`select * from workspaces where id = ${job.workspace_id}`;
  const [prompt] = await sql`select * from prompts where id = ${job.prompt_id}`;
  const rivals = await sql`
    select id, name, domain, aliases from competitors
     where workspace_id = ${job.workspace_id} and active`;

  const brands: BrandRef[] = [
    { id: 'self', name: ws.brand_name, domain: ws.domain, variants: ws.aliases },
    ...rivals.map((r: { id: string; name: string; domain: string | null; aliases: string[] }) =>
      ({ id: r.id, name: r.name, domain: r.domain, variants: r.aliases })),
  ];

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 40_000);
  let answer;
  try {
    answer = await engine.ask({
      prompt: prompt.text,
      language: ws.language,
      country: ws.country_code,
      city: ws.city,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const { run, ranks, citedDomains, degraded } = await extract({
    answerText: answer.text,
    citations: answer.citations,
    brands,
    ownDomain: ws.domain,
  });

  const [inserted] = await sql`
    insert into answer_runs (scan_id, workspace_id, prompt_id, engine_key, run_index,
      model_version, method, latency_ms, answer_text,
      mentioned, rank, cited, recommendation, sentiment, degraded)
    values (${job.scan_id}, ${job.workspace_id}, ${job.prompt_id}, ${job.engine_key}, ${job.run_index},
      ${answer.modelVersion}, ${answer.method}, ${answer.latencyMs}, ${answer.text.slice(0, 20000)},
      ${run.mentioned}, ${run.rank}, ${run.cited}, ${run.recommendation}, ${run.sentiment}, ${degraded ?? null})
    on conflict (scan_id, prompt_id, engine_key, run_index) do update
      set answer_text = excluded.answer_text, mentioned = excluded.mentioned,
          rank = excluded.rank, cited = excluded.cited,
          recommendation = excluded.recommendation, sentiment = excluded.sentiment
    returning id`;

  await sql`delete from run_brands where run_id = ${inserted.id}`;
  const brandRows = Object.entries(ranks)
    .filter(([, rank]) => (rank as number) > 0)
    .map(([id, rank]) => ({
      run_id: inserted.id,
      competitor_id: id === 'self' ? null : id,
      is_self: id === 'self',
      rank: rank as number,
    }));
  if (brandRows.length) await sql`insert into run_brands ${sql(brandRows)} on conflict do nothing`;

  if (citedDomains.length) {
    await sql`insert into run_citations ${sql(
      citedDomains.slice(0, 40).map(d => ({ run_id: inserted.id, domain: d })),
    )} on conflict do nothing`;
  }

  await maybeExtendRuns(job);
}

/**
 * Adaptive sampling. After the third run of a cell, buy two more only if the
 * answers still disagree. On a stable cell this saves ~40% of the bill, which
 * is the difference between a viable price and a loss-making one.
 */
async function maybeExtendRuns(job: Job) {
  if (job.run_index !== 2) return;
  const [scan] = await sql`select runs_target from scans where id = ${job.scan_id}`;
  if (!scan || scan.runs_target <= 3) return;

  const runs = await sql`
    select mentioned, rank, cited, recommendation, sentiment from answer_runs
     where scan_id = ${job.scan_id} and prompt_id = ${job.prompt_id} and engine_key = ${job.engine_key}`;
  if (runs.length < 3) return;
  if (scoreCell(runs.map(r => toRun(r as unknown as RunRow))).ci <= 4) return;

  const extra = [3, 4].slice(0, scan.runs_target - 3).map(i => ({
    scan_id: job.scan_id, workspace_id: job.workspace_id,
    prompt_id: job.prompt_id, engine_key: job.engine_key, run_index: i,
  }));
  if (extra.length) await sql`insert into scan_jobs ${sql(extra)} on conflict do nothing`;
}

interface RunRow {
  mentioned: boolean | null; rank: number | null; cited: boolean | null;
  recommendation: string | null; sentiment: string | number | null;
}

const toRun = (r: RunRow): Run => ({
  mentioned: !!r.mentioned,
  rank: r.rank ?? 0,
  cited: !!r.cited,
  recommendation: (r.recommendation as Run['recommendation']) ?? null,
  sentiment: r.sentiment === null ? null : Number(r.sentiment),
});

/* ------------------------------------------------------------------ */

export async function rollUp(scanId: string, workspaceId: string) {
  const runs = await sql`
    select ar.*, p.intent, p.volume from answer_runs ar
      join prompts p on p.id = ar.prompt_id
     where ar.scan_id = ${scanId}`;

  if (!runs.length) {
    await sql`update scans set status = 'failed', finished_at = now(),
                error = 'no answers were collected' where id = ${scanId}`;
    return null;
  }

  const grouped = new Map<string, { promptId: string; engineKey: string; intent: string; volume: number; runs: Run[] }>();
  for (const r of runs) {
    const k = `${r.prompt_id}|${r.engine_key}`;
    if (!grouped.has(k)) grouped.set(k, { promptId: r.prompt_id, engineKey: r.engine_key, intent: r.intent, volume: r.volume, runs: [] });
    grouped.get(k)!.runs.push(toRun(r as unknown as RunRow));
  }

  const weightRows = await sql`select engine_key, weight from engine_weights where workspace_id = ${workspaceId}`;
  const defaults = await sql`select key, default_weight from engines`;
  const weights: Record<string, number> = {};
  defaults.forEach((d: { key: string; default_weight: string }) => { weights[d.key] = Number(d.default_weight); });
  weightRows.forEach((w: { engine_key: string; weight: string }) => { weights[w.engine_key] = Number(w.weight); });

  const [scan] = await sql`select scan_date from scans where id = ${scanId}`;
  const scanDate = scan.scan_date;

  const cells: Cell[] = [];
  const cellRows: Record<string, unknown>[] = [];
  for (const g of grouped.values()) {
    const result = scoreCell(g.runs);
    cells.push({ promptId: g.promptId, engineKey: g.engineKey, intent: g.intent, volume: g.volume, result });
    cellRows.push({
      workspace_id: workspaceId, scan_date: scanDate, prompt_id: g.promptId, engine_key: g.engineKey,
      score: result.score.toFixed(2), ci: result.ci.toFixed(2),
      m: result.components.m.toFixed(3), pi: result.components.pi.toFixed(3),
      c: result.components.c.toFixed(3), rho: result.components.rho.toFixed(3),
      sigma: result.components.sigma.toFixed(3), mean_rank: result.meanRank.toFixed(2),
    });
  }

  if (cellRows.length) {
    await sql`insert into cell_scores ${sql(cellRows)}
      on conflict (workspace_id, scan_date, prompt_id, engine_key) do update set
        score = excluded.score, ci = excluded.ci, m = excluded.m, pi = excluded.pi,
        c = excluded.c, rho = excluded.rho, sigma = excluded.sigma, mean_rank = excluded.mean_rank`;
  }

  const agg = aggregate(cells, weights);

  const mentionCounts = await sql`
    select coalesce(rb.competitor_id::text, 'self') as brand, count(*)::int as n
      from run_brands rb join answer_runs ar on ar.id = rb.run_id
     where ar.scan_id = ${scanId} group by 1`;
  const sov = shareOfVoice(Object.fromEntries(
    mentionCounts.map((m: { brand: string; n: number }) => [m.brand, m.n])));

  await sql`
    insert into daily_scores (workspace_id, scan_date, score, ci, low_confidence,
      mention_rate, citation_rate, share_of_voice, by_engine)
    values (${workspaceId}, ${scanDate}, ${agg.score.toFixed(2)}, ${agg.ci.toFixed(2)},
      ${agg.lowConfidence}, ${agg.mentionRate.toFixed(2)}, ${agg.citationRate.toFixed(2)},
      ${(sov['self'] ?? 0).toFixed(2)}, ${sql.json(agg.byEngine)})
    on conflict (workspace_id, scan_date) do update set
      score = excluded.score, ci = excluded.ci, low_confidence = excluded.low_confidence,
      mention_rate = excluded.mention_rate, citation_rate = excluded.citation_rate,
      share_of_voice = excluded.share_of_voice, by_engine = excluded.by_engine`;

  const [{ n: stuck }] = await sql`
    select count(*)::int as n from scan_jobs
     where scan_id = ${scanId} and done_at is null`;
  await sql`update scans set status = ${stuck > 0 ? 'partial' : 'done'}, finished_at = now()
             where id = ${scanId}`;

  return agg;
}

import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { PLAN_RANK, limits, type PlanKey } from '@/lib/plans';
import { opportunityScore, type Intent } from '@/lib/prompts';
import { engineByKey } from '@/lib/engines';

export const dynamic = 'force-dynamic';

/**
 * Everything the dashboard needs, in one round trip.
 *
 * The plan gate is applied HERE, not in the browser. A locked engine's numbers
 * must never reach the client — otherwise "upgrade to see" is a paywall anyone
 * bypasses with devtools.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace');
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 30), 1), 365);
  if (!workspaceId) return Response.json({ error: 'workspace required' }, { status: 400 });
  const ws = await requireWorkspace(s, workspaceId);

  const engineRows = await sql`select key, label, default_weight, min_plan, sort_order from engines order by sort_order`;
  // Three distinct states, and conflating them is how a dashboard lies:
  //   locked      — above the plan, we deliberately did not ask
  //   unconfigured— no API key on the server, we could not ask
  //   active      — we asked, so a zero means a real absence
  // Showing 0.00 for the first two reads as "your brand is invisible there",
  // which is a different and much worse claim than "we never looked".
  const engines = engineRows.map((e: { key: string; label: string; default_weight: string; min_plan: PlanKey }) => {
    const locked = PLAN_RANK[s.plan as PlanKey] < PLAN_RANK[e.min_plan];
    const configured = !!engineByKey(e.key)?.enabled();
    return {
      key: e.key,
      label: e.label,
      weight: Number(e.default_weight),
      locked,
      configured,
      active: !locked && configured,
    };
  });
  const allowed = engines.filter(e => e.active).map(e => e.key);

  const [latestRow] = await sql`
    select * from daily_scores where workspace_id = ${workspaceId} order by scan_date desc limit 1`;

  const [series, cells, sources, competitors, recent, scanState, audit, rivalGaps] = await Promise.all([
    // by_engine comes along so the dashboard can draw a trace per platform.
    // One aggregate line hides the case that matters most: holding steady
    // overall while collapsing on the engine with the heaviest weight.
    sql`select scan_date, score, ci, low_confidence, mention_rate, citation_rate,
               share_of_voice, by_engine
          from daily_scores
         where workspace_id = ${workspaceId} and scan_date > current_date - ${days}::int
         order by scan_date`,

    // Per-cell detail plus the id of one run behind it, so the mentions table
    // can open the raw answer that produced the number.
    sql`select cs.prompt_id, cs.engine_key, cs.score, cs.ci, cs.m, cs.pi, cs.c, cs.rho, cs.sigma, cs.mean_rank,
               p.text, p.intent, p.volume, p.source,
               (select ar.id from answer_runs ar
                 where ar.workspace_id = cs.workspace_id and ar.prompt_id = cs.prompt_id
                   and ar.engine_key = cs.engine_key
                 order by ar.mentioned desc nulls last, ar.asked_at desc limit 1) as run_id
          from cell_scores cs join prompts p on p.id = cs.prompt_id
         where cs.workspace_id = ${workspaceId}
           and cs.scan_date = (select max(scan_date) from cell_scores where workspace_id = ${workspaceId})
           and cs.engine_key = any(${allowed})`,

    sql`select rc.domain, count(*)::int as citations,
               min(ar.asked_at)::date as first_seen, max(ar.asked_at)::date as last_seen
          from run_citations rc join answer_runs ar on ar.id = rc.run_id
         where ar.workspace_id = ${workspaceId}
           and ar.asked_at > now() - make_interval(days => ${days})
           and ar.engine_key = any(${allowed})
         group by rc.domain order by citations desc limit 40`,

    sql`select c.id, c.name, c.domain,
               count(rb.*)::int as mentions,
               round(avg(rb.rank)::numeric, 2) as mean_rank
          from competitors c
          left join run_brands rb on rb.competitor_id = c.id
          left join answer_runs ar on ar.id = rb.run_id
             and ar.asked_at > now() - make_interval(days => ${days})
             and ar.engine_key = any(${allowed})
         where c.workspace_id = ${workspaceId} and c.active
         group by c.id order by mentions desc`,

    sql`select ar.id, ar.engine_key, ar.rank, ar.asked_at, ar.mentioned, p.text
          from answer_runs ar join prompts p on p.id = ar.prompt_id
         where ar.workspace_id = ${workspaceId} and ar.mentioned
           and ar.engine_key = any(${allowed})
         order by ar.asked_at desc limit 12`,


    sql`select id, status, scan_date, queued_jobs, started_at, finished_at, error,
               (select count(*)::int from scan_jobs j
                 where j.scan_id = scans.id and j.done_at is null and j.attempts < 4) as pending,
               (select count(*)::int from scan_jobs j
                 where j.scan_id = scans.id and j.done_at is null and j.attempts >= 4) as failed,
               -- Report an error the moment it happens, not after four retries.
               -- A wrong key otherwise hides behind "scan in progress" for minutes.
               (select json_agg(distinct jsonb_build_object('engine', j.engine_key, 'error', left(j.error, 200)))
                  from scan_jobs j
                 where j.scan_id = scans.id and j.error is not null and j.done_at is null) as failures
          from scans where workspace_id = ${workspaceId} order by scan_date desc limit 1`,

    sql`select a.id, a.url, a.ran_at, a.total_score,
               coalesce(json_agg(json_build_object(
                 'key', f.factor_key, 'category', f.category, 'label', f.label,
                 'status', f.status, 'detail', f.detail, 'fix', f.fix
               ) order by f.category) filter (where f.factor_key is not null), '[]') as factors
          from audits a left join audit_factors f on f.audit_id = a.id
         where a.workspace_id = ${workspaceId}
         group by a.id order by a.ran_at desc limit 1`,

    /**
     * Per-query competitive gap: for every tracked query, the rival that ranks
     * best in the answers, and how that compares with us.
     *
     * Every tool in this category reports a share-of-voice total and stops.
     * A total tells a marketer they are losing; it never tells them *where*,
     * and "where" is the only form of the fact that can be worked on. This is
     * the join the product exists to make — run_brands already holds it.
     */
    sql`
      with self_rank as (
        select ar.prompt_id, avg(rb.rank)::numeric as r
          from run_brands rb
          join answer_runs ar on ar.id = rb.run_id
         where ar.workspace_id = ${workspaceId} and rb.is_self
           and ar.asked_at > now() - make_interval(days => ${days})
           and ar.engine_key = any(${allowed})
         group by ar.prompt_id
      ),
      rival_rank as (
        select ar.prompt_id, c.name,
               avg(rb.rank)::numeric as r,
               count(*)::int as hits,
               row_number() over (partition by ar.prompt_id order by avg(rb.rank)) as pos
          from run_brands rb
          join answer_runs ar on ar.id = rb.run_id
          join competitors c on c.id = rb.competitor_id
         where ar.workspace_id = ${workspaceId} and rb.competitor_id is not null
           and ar.asked_at > now() - make_interval(days => ${days})
           and ar.engine_key = any(${allowed})
         group by ar.prompt_id, c.name
      )
      select p.id as prompt_id, p.text, p.intent, p.volume,
             round(s.r, 2) as self_rank,
             r.name as rival_name,
             round(r.r, 2) as rival_rank,
             r.hits as rival_hits
        from prompts p
        left join self_rank s on s.prompt_id = p.id
        left join rival_rank r on r.prompt_id = p.id and r.pos = 1
       where p.workspace_id = ${workspaceId} and p.active
       order by p.volume desc`,
  ]);

  // Measurement quality. `degraded` is written per run when the judge could
  // not be reached or the brand set changed under stored answers. It was
  // recorded and never shown, so a customer could be reading a dashboard where
  // every tone score is a floor value and nothing on screen said so.
  const [quality] = await sql`
    select count(*) filter (where degraded is not null)::int as degraded,
           count(*)::int as total,
           mode() within group (order by degraded) as reason
      from answer_runs
     where workspace_id = ${workspaceId}
       and asked_at > now() - make_interval(days => ${days})`;

  // Self mentions, for share of voice against the tracked competitor set.
  const [selfCount] = await sql`
    select count(*)::int as n from run_brands rb join answer_runs ar on ar.id = rb.run_id
     where ar.workspace_id = ${workspaceId} and rb.is_self
       and ar.asked_at > now() - make_interval(days => ${days})
       and ar.engine_key = any(${allowed})`;

  // Every active prompt is listed, whether or not it has been scanned yet.
  // Deriving the list from scores would hide brand-new prompts until the next
  // scan, which is exactly when the user wants to see them.
  const allPrompts = await sql`
    select id, text, intent, volume, source from prompts
     where workspace_id = ${workspaceId} and active order by volume desc`;

  // Per-prompt rollup across engines, plus the opportunity score.
  const byPrompt = new Map<string, {
    id: string; text: string; intent: Intent; volume: number; source: string;
    engines: Record<string, number>; score: number; ci: number; coverage: number; n: number;
  }>();
  for (const c of cells) {
    const e = byPrompt.get(c.prompt_id) ?? {
      id: c.prompt_id, text: c.text, intent: c.intent as Intent, volume: c.volume,
      source: c.source, engines: {}, score: 0, ci: 0, coverage: 0, n: 0,
    };
    e.engines[c.engine_key] = Number(c.score);
    e.score += Number(c.score);
    e.ci += Number(c.ci) ** 2;
    e.coverage += Number(c.m) > 0 ? 1 : 0;
    e.n += 1;
    byPrompt.set(c.prompt_id, e);
  }

  const sourceCount = sources.length || 1;
  const prompts = allPrompts.map((row: {
    id: string; text: string; intent: Intent; volume: number; source: string;
  }) => {
    const p = byPrompt.get(row.id) ?? {
      id: row.id, text: row.text, intent: row.intent, volume: row.volume,
      source: row.source, engines: {}, score: 0, ci: 0, coverage: 0, n: 0,
    };
    const coverage = p.n ? p.coverage / p.n : 0;
    return {
      id: p.id, text: row.text, intent: row.intent, volume: row.volume, source: row.source,
      scanned: p.n > 0,
      score: p.n ? +(p.score / p.n).toFixed(2) : 0,
      ci: p.n ? +(Math.sqrt(p.ci) / p.n).toFixed(2) : 0,
      coverage: +(coverage * 100).toFixed(1),
      engines: p.engines,
      opportunity: opportunityScore({
        coverage,
        volume: row.volume,
        sourceCount: Math.min(sourceCount, 12),
        fit: coverage > 0.5 ? 'high' : coverage > 0 ? 'medium' : 'low',
        intent: row.intent,
      }),
    };
  });

  // Per-engine health. An engine we asked but that errored on every call is
  // not a zero — it is an unknown, and printing 0.00 for it claims the brand
  // is invisible there when in fact we never got an answer.
  const cellsByEngine = new Map<string, number>();
  for (const c of cells) {
    cellsByEngine.set(c.engine_key as string, (cellsByEngine.get(c.engine_key as string) ?? 0) + 1);
  }
  const failingEngines = new Set(
    ((scanState[0]?.failures ?? []) as { engine: string }[]).map(f => f.engine));

  const enginesWithHealth = engines.map(e => ({
    ...e,
    measured: (cellsByEngine.get(e.key) ?? 0) > 0,
    failing: failingEngines.has(e.key),
  }));

  const ownHost = ws.domain.replace(/^https?:\/\//, '').replace(/^www\./, '');

  return Response.json({
    cells: cells.map((c: Record<string, unknown>) => ({
      promptId: c.prompt_id, engineKey: c.engine_key, runId: c.run_id,
      text: c.text, intent: c.intent, volume: c.volume,
      score: Number(c.score), ci: Number(c.ci),
      m: Number(c.m), pi: Number(c.pi), c: Number(c.c), rho: Number(c.rho), sigma: Number(c.sigma),
      meanRank: c.mean_rank === null ? 0 : Number(c.mean_rank),
    })),
    workspace: {
      id: ws.id, brandName: ws.brand_name, domain: ws.domain, host: ownHost,
      sector: ws.sector, country: ws.country, city: ws.city,
      language: ws.language, aliases: ws.aliases, onboarded: ws.onboarded,
    },
    org: { plan: s.plan, planLimits: limits(s.plan as PlanKey), trialEndsAt: s.trialEndsAt },
    engines: enginesWithHealth,
    latest: latestRow ?? null,
    series,
    prompts,
    sources: sources.map((r: { domain: string; citations: number; first_seen: string; last_seen: string }) => ({
      ...r, mine: r.domain === ownHost,
    })),
    competitors,
    selfMentions: selfCount?.n ?? 0,
    recentMentions: recent,
    rivalGaps: rivalGaps.map(g => ({
      promptId: g.prompt_id, text: g.text, intent: g.intent, volume: Number(g.volume),
      selfRank: g.self_rank === null ? null : Number(g.self_rank),
      rivalName: g.rival_name ?? null,
      rivalRank: g.rival_rank === null ? null : Number(g.rival_rank),
      rivalHits: g.rival_hits === null ? 0 : Number(g.rival_hits),
    })),
    scan: scanState[0] ?? null,
    audit: audit[0] ?? null,
    quality: {
      degraded: Number(quality?.degraded ?? 0),
      total: Number(quality?.total ?? 0),
      reason: (quality?.reason as string) ?? null,
    },
  });
});

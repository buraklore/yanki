import { sql } from './db';

/**
 * digest.ts — turning a checklist into a monitoring system.
 *
 * A customer who runs the audit, fixes 26 factors and watches the score rise
 * has no reason to pay again next month. The thing that keeps them is not a
 * better dashboard; it is the product noticing a loss before they do and
 * telling them. "You were second on this prompt last week, you are fifth now,
 * and Klasgame passed you" cannot be replaced by logging in occasionally.
 *
 * Everything here is derived from scans we already ran. Detection compares two
 * days of stored results; nothing calls a provider.
 */

export type ChangeKind =
  | 'score_drop' | 'score_rise'
  | 'rank_loss' | 'rank_gain'
  | 'lost_mention' | 'new_mention'
  | 'rival_overtake' | 'rival_surge'
  | 'citation_lost' | 'citation_gained';

export interface ChangeEvent {
  kind: ChangeKind;
  severity: 1 | 2 | 3;
  promptId?: string | null;
  promptText?: string;
  engineKey?: string | null;
  engineLabel?: string;
  competitorId?: string | null;
  competitorName?: string;
  before?: number | null;
  after?: number | null;
  detail: string;
}

/** A drop this size is noise on a five-run average; below it we stay quiet. */
const SCORE_NOISE = 3.0;
const RANK_NOISE = 0.8;

/**
 * Compares the latest scan against the previous one and records what moved.
 *
 * Idempotent: the unique index on change_events means a cron retry cannot
 * duplicate a week's alerts.
 */
export async function detectChanges(workspaceId: string) {
  const dates = await sql`
    select distinct scan_date from cell_scores
     where workspace_id = ${workspaceId}
     order by scan_date desc limit 2`;
  if (dates.length < 2) return { events: 0, reason: 'not_enough_history' as const };

  const today = dates[0].scan_date as string;
  const prev = dates[1].scan_date as string;
  const events: ChangeEvent[] = [];

  /* ---- overall score ---- */
  const scores = await sql`
    select scan_date, score from daily_scores
     where workspace_id = ${workspaceId} and scan_date in (${today}, ${prev})`;
  const nowScore = scores.find(r => String(r.scan_date) === String(today));
  const wasScore = scores.find(r => String(r.scan_date) === String(prev));
  if (nowScore && wasScore) {
    const delta = Number(nowScore.score) - Number(wasScore.score);
    if (Math.abs(delta) >= SCORE_NOISE) {
      events.push({
        kind: delta < 0 ? 'score_drop' : 'score_rise',
        severity: Math.abs(delta) >= 8 ? 3 : 2,
        before: Number(wasScore.score), after: Number(nowScore.score),
        detail: `Görünürlük skoru ${Number(wasScore.score).toFixed(1)} → ${Number(nowScore.score).toFixed(1)}`,
      });
    }
  }

  /* ---- per prompt × engine ---- */
  const cells = await sql`
    select cs.scan_date, cs.prompt_id, cs.engine_key, cs.m, cs.c,
           cs.mean_rank, cs.score, p.text as prompt_text, e.label as engine_label
      from cell_scores cs
      join prompts p on p.id = cs.prompt_id
      join engines e on e.key = cs.engine_key
     where cs.workspace_id = ${workspaceId} and cs.scan_date in (${today}, ${prev})`;

  const key = (r: Record<string, unknown>) => `${r.prompt_id}|${r.engine_key}`;
  const nowCells = new Map<string, Record<string, unknown>>();
  const prevCells = new Map<string, Record<string, unknown>>();
  for (const r of cells) {
    (String(r.scan_date) === String(today) ? nowCells : prevCells).set(key(r), r);
  }

  for (const [k, n] of nowCells) {
    const p = prevCells.get(k);
    if (!p) continue;
    const base = {
      promptId: n.prompt_id as string,
      promptText: n.prompt_text as string,
      engineKey: n.engine_key as string,
      engineLabel: n.engine_label as string,
    };

    const wasMentioned = Number(p.m) > 0;
    const isMentioned = Number(n.m) > 0;

    // Falling out of an answer entirely is the single most important signal.
    if (wasMentioned && !isMentioned) {
      events.push({ ...base, kind: 'lost_mention', severity: 3,
        before: Number(p.m), after: 0,
        detail: `${base.engineLabel} artık bu sorguda markanızı anmıyor` });
      continue;
    }
    if (!wasMentioned && isMentioned) {
      events.push({ ...base, kind: 'new_mention', severity: 2,
        before: 0, after: Number(n.m),
        detail: `${base.engineLabel} bu sorguda markanızı anmaya başladı` });
      continue;
    }
    if (!isMentioned) continue;

    const pr = p.mean_rank == null ? null : Number(p.mean_rank);
    const nr = n.mean_rank == null ? null : Number(n.mean_rank);
    if (pr && nr && Math.abs(nr - pr) >= RANK_NOISE) {
      // Rank counts upward: a bigger number is a worse position.
      const worse = nr > pr;
      events.push({ ...base, kind: worse ? 'rank_loss' : 'rank_gain',
        severity: worse ? (nr - pr >= 2 ? 3 : 2) : 1,
        before: pr, after: nr,
        detail: `Sıralama ${pr.toFixed(1)} → ${nr.toFixed(1)} (${base.engineLabel})` });
    }

    const wasCited = Number(p.c) > 0;
    const isCited = Number(n.c) > 0;
    if (wasCited && !isCited) {
      events.push({ ...base, kind: 'citation_lost', severity: 2,
        detail: `Siteniz bu sorguda artık kaynak gösterilmiyor (${base.engineLabel})` });
    } else if (!wasCited && isCited) {
      events.push({ ...base, kind: 'citation_gained', severity: 1,
        detail: `Siteniz bu sorguda kaynak gösterilmeye başladı (${base.engineLabel})` });
    }
  }

  /* ---- competitors ---- */
  const rivalCounts = await sql`
    select d.scan_date, c.id, c.name, count(*)::int as mentions
      from (select ${today}::date as scan_date union all select ${prev}::date) d
      join answer_runs ar on ar.workspace_id = ${workspaceId} and ar.asked_at::date = d.scan_date
      join run_brands rb on rb.run_id = ar.id and rb.competitor_id is not null
      join competitors c on c.id = rb.competitor_id
     group by d.scan_date, c.id, c.name`;

  const selfCounts = await sql`
    select d.scan_date, count(*)::int as mentions
      from (select ${today}::date as scan_date union all select ${prev}::date) d
      join answer_runs ar on ar.workspace_id = ${workspaceId} and ar.asked_at::date = d.scan_date
      join run_brands rb on rb.run_id = ar.id and rb.is_self
     group by d.scan_date`;

  const mineNow = Number(selfCounts.find(r => String(r.scan_date) === String(today))?.mentions ?? 0);
  const minePrev = Number(selfCounts.find(r => String(r.scan_date) === String(prev))?.mentions ?? 0);

  const rivalNow = new Map<string, { name: string; n: number }>();
  const rivalPrev = new Map<string, { name: string; n: number }>();
  for (const r of rivalCounts as unknown as { scan_date: string; id: string; name: string; mentions: number }[]) {
    (String(r.scan_date) === String(today) ? rivalNow : rivalPrev)
      .set(r.id, { name: r.name, n: r.mentions });
  }

  for (const [id, now] of rivalNow) {
    const before = rivalPrev.get(id)?.n ?? 0;
    // Overtaking is worth an alert on its own: it is the moment a customer
    // loses ground to a named competitor, which is what they actually fear.
    if (before <= minePrev && now.n > mineNow) {
      events.push({ kind: 'rival_overtake', severity: 3, competitorId: id, competitorName: now.name,
        before, after: now.n,
        detail: `${now.name} sizi geçti — ${now.n} bahse karşı sizin ${mineNow}` });
    } else if (now.n - before >= 4) {
      events.push({ kind: 'rival_surge', severity: 2, competitorId: id, competitorName: now.name,
        before, after: now.n,
        detail: `${now.name} bu hafta ${now.n - before} yeni bahiste görünmeye başladı` });
    }
  }

  if (events.length) {
    await sql`insert into change_events ${sql(events.map(e => ({
      workspace_id: workspaceId, scan_date: today, kind: e.kind, severity: e.severity,
      prompt_id: e.promptId ?? null, engine_key: e.engineKey ?? null,
      competitor_id: e.competitorId ?? null,
      before_val: e.before ?? null, after_val: e.after ?? null, detail: e.detail,
    })))} on conflict do nothing`;
  }

  return { events: events.length, today, prev, list: events };
}

export interface DigestSummary {
  brand: string;
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  score: { now: number | null; before: number | null; delta: number | null };
  urgent: ChangeEvent[];
  wins: ChangeEvent[];
  rivals: { name: string; delta: number; mentions: number }[];
  /** Prompts where coverage fell — the input to the content loop. */
  contentTargets: { promptId: string; text: string; coverage: number; volume: number }[];
  counts: { mentions: number; citations: number; checks: number };
}

/**
 * Builds the week's story: what got worse, what got better, and what to write.
 * Used for both the email and the in-app "what changed" panel.
 */
export async function buildDigest(workspaceId: string, days = 7): Promise<DigestSummary | null> {
  const [ws] = await sql`select id, brand_name from workspaces where id = ${workspaceId}`;
  if (!ws) return null;

  const [range] = await sql`
    select min(scan_date)::text as start, max(scan_date)::text as end
      from daily_scores
     where workspace_id = ${workspaceId} and scan_date > current_date - ${days}::int`;
  if (!range?.end) return null;

  const scores = await sql`
    select scan_date, score from daily_scores
     where workspace_id = ${workspaceId} and scan_date > current_date - ${days + 1}::int
     order by scan_date`;
  const first = scores[0], last = scores[scores.length - 1];

  const raw = await sql`
    select ce.*, p.text as prompt_text, e.label as engine_label, c.name as rival_name
      from change_events ce
      left join prompts p on p.id = ce.prompt_id
      left join engines e on e.key = ce.engine_key
      left join competitors c on c.id = ce.competitor_id
     where ce.workspace_id = ${workspaceId}
       and ce.scan_date > current_date - ${days}::int
     order by ce.severity desc, ce.created_at desc`;

  const toEvent = (r: Record<string, unknown>): ChangeEvent => ({
    kind: r.kind as ChangeKind,
    severity: Number(r.severity) as 1 | 2 | 3,
    promptId: r.prompt_id as string | null,
    promptText: (r.prompt_text as string) ?? undefined,
    engineKey: r.engine_key as string | null,
    engineLabel: (r.engine_label as string) ?? undefined,
    competitorId: r.competitor_id as string | null,
    competitorName: (r.rival_name as string) ?? undefined,
    before: r.before_val == null ? null : Number(r.before_val),
    after: r.after_val == null ? null : Number(r.after_val),
    detail: r.detail as string,
  });

  const BAD: ChangeKind[] = ['score_drop', 'rank_loss', 'lost_mention', 'rival_overtake', 'rival_surge', 'citation_lost'];
  const events = raw.map(toEvent);

  const rivalRows = await sql`
    select c.name, count(*)::int as mentions
      from run_brands rb
      join answer_runs ar on ar.id = rb.run_id
      join competitors c on c.id = rb.competitor_id
     where ar.workspace_id = ${workspaceId} and c.active
       and ar.asked_at > now() - make_interval(days => ${days})
     group by c.name order by mentions desc limit 5`;

  const targets = await sql`
    select cs.prompt_id, p.text, p.volume,
           avg(cs.m)::numeric as coverage
      from cell_scores cs
      join prompts p on p.id = cs.prompt_id
     where cs.workspace_id = ${workspaceId}
       and cs.scan_date > current_date - ${days}::int
       and p.active
     group by cs.prompt_id, p.text, p.volume
     having avg(cs.m) < 0.4
     order by p.volume desc nulls last limit 3`;

  const [counts] = await sql`
    select
      count(*) filter (where rb.is_self)::int as mentions,
      (select count(*)::int from run_citations rc
        join answer_runs a2 on a2.id = rc.run_id
       where a2.workspace_id = ${workspaceId}
         and a2.asked_at > now() - make_interval(days => ${days})) as citations,
      (select count(*)::int from answer_runs a3
        where a3.workspace_id = ${workspaceId}
          and a3.asked_at > now() - make_interval(days => ${days})) as checks
      from answer_runs ar
      left join run_brands rb on rb.run_id = ar.id
     where ar.workspace_id = ${workspaceId}
       and ar.asked_at > now() - make_interval(days => ${days})`;

  return {
    brand: String(ws.brand_name),
    workspaceId,
    periodStart: String(range.start ?? range.end),
    periodEnd: String(range.end),
    score: {
      now: last ? Number(last.score) : null,
      before: first ? Number(first.score) : null,
      delta: first && last ? Number(last.score) - Number(first.score) : null,
    },
    urgent: events.filter(e => BAD.includes(e.kind)).slice(0, 8),
    wins: events.filter(e => !BAD.includes(e.kind)).slice(0, 5),
    rivals: (rivalRows as unknown as { name: string; mentions: number }[])
      .map(r => ({ name: r.name, mentions: r.mentions, delta: 0 })),
    contentTargets: (targets as unknown as {
      prompt_id: string; text: string; volume: number; coverage: string;
    }[]).map(t => ({
      promptId: t.prompt_id, text: t.text,
      coverage: Number(t.coverage), volume: Number(t.volume ?? 0),
    })),
    counts: {
      mentions: Number(counts?.mentions ?? 0),
      citations: Number(counts?.citations ?? 0),
      checks: Number(counts?.checks ?? 0),
    },
  };
}

import { z } from 'zod';
import { llmText, llmAvailable } from './llm';
import { sql } from './db';

/**
 * attributes.ts — what the models actually say about each brand.
 *
 * A visibility score tells a customer they are losing. It does not tell them
 * why. The why is almost always positioning: the model calls the rival
 * "güvenilir" and calls you "ucuz", and no amount of schema markup changes
 * that. Extracting those adjectives turns the product from a scoreboard into
 * something that can be acted on.
 *
 * The pass runs over answers already on disk, so it never re-queries a
 * provider. One cheap model call covers a batch of answers.
 *
 * As with mention extraction, the model is not trusted to invent. It may only
 * attach an attribute to a brand that we already confirmed appears in that
 * answer; anything else is discarded here rather than stored.
 */

const SYSTEM = `You read an AI assistant's answer and report which qualities it attaches to which brand.

You are given the answer text and the list of brands known to appear in it.

Rules:
- Only use brands from the given list. Never introduce a brand that is not on it.
- Report a quality only if the text actually attributes it to that brand.
  Good:  "Bynogame hızlı teslimat ile biliniyor"        -> Bynogame / hızlı teslimat / positive
  Bad:   the text mentions fast delivery in general      -> report nothing
- Use the wording of the text, reduced to a short noun phrase of 1-3 words.
- polarity: 1 if the quality is presented favourably, -1 if unfavourably,
  0 if neutral or purely factual.
- evidence: the clause the quality came from, at most 20 words, copied verbatim.
- At most 6 qualities per brand. Skip brands the answer says nothing about.

Return ONLY minified JSON, no prose, no markdown fences:
{"items":[{"brand":"<exact name from the list>","attribute":"<1-3 words>","polarity":1,"evidence":"..."}]}`;

const Payload = z.object({
  items: z.array(z.object({
    brand: z.string().min(1).max(120),
    attribute: z.string().min(2).max(60),
    polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    evidence: z.string().max(300).optional(),
  })).max(80),
});

export const attributesAvailable = () => llmAvailable();

/** Lower-cases with Turkish rules and strips punctuation, for grouping. */
export function normaliseAttribute(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function callJudge(user: string): Promise<string | null> {
  return llmText({
    system: SYSTEM,
    user,
    maxTokens: 1500,
    temperature: 0,
    model: process.env.ATTRIBUTE_MODEL || process.env.JUDGE_MODEL,
  });
}

interface RunRow {
  id: string;
  answer_text: string;
  brands: { id: string | null; name: string; is_self: boolean }[];
}

/**
 * Extracts attributes for answers that have not been through the pass.
 *
 * `limit` bounds the provider spend of a single call; the cron keeps calling
 * until nothing is left. Answers with fewer than two confirmed brands are
 * skipped — an attribute is only interesting next to a comparison.
 */
export async function extractAttributes(
  workspaceId: string,
  opts: { limit?: number; budgetMs?: number } = {},
) {
  const limit = opts.limit ?? 25;
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);

  if (!attributesAvailable()) {
    return { processed: 0, items: 0, skipped: 'no_judge_key' as const };
  }

  const rows = await sql`
    select ar.id, ar.answer_text,
           json_agg(json_build_object(
             'id',   rb.competitor_id,
             'name', coalesce(c.name, w.brand_name),
             'is_self', rb.is_self
           ) order by rb.rank) as brands
      from answer_runs ar
      join workspaces w on w.id = ar.workspace_id
      join run_brands rb on rb.run_id = ar.id
      left join competitors c on c.id = rb.competitor_id
     where ar.workspace_id = ${workspaceId}
       and ar.attributes_at is null
       and ar.answer_text is not null
       and length(ar.answer_text) > 120
     group by ar.id, ar.answer_text
    having count(*) >= 1
     order by ar.asked_at desc
     limit ${limit}` as unknown as RunRow[];

  let processed = 0, items = 0;

  for (const run of rows) {
    if (Date.now() > deadline) break;

    const byName = new Map<string, { id: string | null; is_self: boolean }>();
    for (const b of run.brands) {
      if (b?.name) byName.set(b.name.toLocaleLowerCase('tr'), { id: b.id, is_self: !!b.is_self });
    }
    if (!byName.size) {
      await sql`update answer_runs set attributes_at = now() where id = ${run.id}`;
      continue;
    }

    const user = [
      'Brands present in this answer:',
      ...run.brands.map(b => `- ${b.name}`),
      '',
      'Answer:',
      run.answer_text.slice(0, 6000),
    ].join('\n');

    let parsed: z.infer<typeof Payload> | null = null;
    try {
      const raw = await callJudge(user);
      if (raw) parsed = Payload.parse(JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim()));
    } catch {
      // A judge failure must not block the queue or corrupt the table. Leave
      // attributes_at null so the next pass retries this answer.
      continue;
    }
    if (!parsed) {
      await sql`update answer_runs set attributes_at = now() where id = ${run.id}`;
      continue;
    }

    const seen = new Set<string>();
    const toInsert: Record<string, unknown>[] = [];

    for (const it of parsed.items) {
      // The model may only label brands we already confirmed in this answer.
      const brand = byName.get(it.brand.trim().toLocaleLowerCase('tr'));
      if (!brand) continue;

      const attr = normaliseAttribute(it.attribute);
      if (attr.length < 2 || attr.split(' ').length > 4) continue;

      const key = `${brand.id ?? 'self'}|${attr}`;
      if (seen.has(key)) continue;
      seen.add(key);

      toInsert.push({
        run_id: run.id,
        workspace_id: workspaceId,
        competitor_id: brand.id,
        is_self: brand.is_self,
        attribute: attr,
        attribute_raw: it.attribute.trim().slice(0, 60),
        polarity: it.polarity,
        evidence: it.evidence?.trim().slice(0, 300) ?? null,
      });
    }

    if (toInsert.length) {
      await sql`insert into run_attributes ${sql(toInsert)} on conflict do nothing`;
      items += toInsert.length;
    }
    await sql`update answer_runs set attributes_at = now() where id = ${run.id}`;
    processed++;
  }

  const [{ n: remaining }] = await sql`
    select count(*)::int as n from answer_runs
     where workspace_id = ${workspaceId} and attributes_at is null
       and answer_text is not null and length(answer_text) > 120`;

  return { processed, items, remaining };
}

export interface AttributeRow {
  attribute: string;
  label: string;
  /** brandId ('self' for the workspace brand) -> count and average polarity */
  brands: Record<string, { n: number; polarity: number }>;
  total: number;
}

/**
 * The attribute × brand matrix the panel renders.
 *
 * Sorted by how lopsided each attribute is, not by raw volume: an attribute
 * both brands own equally teaches the customer nothing, while one a rival owns
 * outright is exactly the gap they need to see.
 */
export async function attributeMatrix(workspaceId: string, days = 30) {
  const rows = await sql`
    select ra.attribute,
           mode() within group (order by ra.attribute_raw) as label,
           coalesce(ra.competitor_id::text, 'self') as brand_id,
           count(*)::int as n,
           round(avg(ra.polarity)::numeric, 2) as polarity
      from run_attributes ra
      join answer_runs ar on ar.id = ra.run_id
     where ra.workspace_id = ${workspaceId}
       and ar.asked_at > now() - make_interval(days => ${days})
     group by ra.attribute, brand_id
     having count(*) >= 2`;

  const map = new Map<string, AttributeRow>();
  for (const r of rows as unknown as {
    attribute: string; label: string; brand_id: string; n: number; polarity: string;
  }[]) {
    if (!map.has(r.attribute)) {
      map.set(r.attribute, { attribute: r.attribute, label: r.label, brands: {}, total: 0 });
    }
    const row = map.get(r.attribute)!;
    row.brands[r.brand_id] = { n: r.n, polarity: Number(r.polarity) };
    row.total += r.n;
  }

  const list = [...map.values()];

  // Imbalance: how far the leader is ahead of us on this attribute. Highest
  // first, because that is the list a marketer should work from.
  const scored = list.map(a => {
    const mine = a.brands['self']?.n ?? 0;
    const best = Math.max(0, ...Object.entries(a.brands).filter(([k]) => k !== 'self').map(([, v]) => v.n));
    return { ...a, mine, best, gap: best - mine };
  });

  scored.sort((a, b) => (b.gap - a.gap) || (b.total - a.total));
  return scored;
}

/** Counts for the empty-state copy: how far along the pass is. */
export async function attributeCoverage(workspaceId: string) {
  const [row] = await sql`
    select
      (select count(*)::int from answer_runs
        where workspace_id = ${workspaceId} and answer_text is not null and length(answer_text) > 120) as total,
      (select count(*)::int from answer_runs
        where workspace_id = ${workspaceId} and attributes_at is not null) as done,
      (select count(*)::int from run_attributes where workspace_id = ${workspaceId}) as items`;
  return {
    total: Number(row.total), done: Number(row.done), items: Number(row.items),
    available: attributesAvailable(),
  };
}

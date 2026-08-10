/**
 * extract.ts — turn one raw answer into one scored Run.
 *
 * Layer 1 (entity.ts) finds candidate mentions with regex. It is fast, free
 * and reproducible, but it cannot tell "Norma the CRM" from "norma" the noun,
 * and it cannot judge tone.
 *
 * Layer 2 asks a cheap model to adjudicate — but only about candidates layer 1
 * already found. The judge can veto a match and grade it; it can never invent
 * one. That asymmetry is deliberate: a hallucinated mention would inflate a
 * customer's score, which is the one error we can never ship.
 */

import { buildAliases, findMentions, rankBrands, extractDomains, key, type BrandInput } from './entity';
import { llmJson, llmProvider } from './llm';
import type { Run, Recommendation } from './score';

export interface BrandRef extends BrandInput { id: string }

export interface ExtractInput {
  answerText: string;
  citations: { url: string; title?: string }[];
  /** Index 0 must be the workspace's own brand. */
  brands: BrandRef[];
  ownDomain: string;
}

export interface ExtractResult {
  run: Run;
  /** Rank per brand id, for share-of-voice and the competitor heat map. */
  ranks: Record<string, number>;
  citedDomains: string[];
  /** Which brands the judge confirmed, for audit. */
  confirmed: string[];
  /** Populated when the judge was unavailable and we fell back to regex only. */
  degraded?: string;
}

const JUDGE_SYSTEM = `You verify brand mentions inside an AI-generated answer.

You are given the answer and a list of CANDIDATE brands that a matcher already
found. For each candidate decide whether the text really refers to that brand
as a company/product, not an unrelated common word or a different company.

Return ONLY minified JSON, no prose, no markdown fences:
{"brands":[{"id":"...","isBrand":true,"recommendation":"primary|listed|neutral|conditional|negative","sentiment":-1.0..1.0,"evidence":"<=15 words quoted from the answer"}]}

recommendation:
  primary     the answer's top / first-choice suggestion
  listed      one of several suggestions, presented favourably
  neutral     named without endorsement
  conditional recommended only for a narrow case ("if you are a small team")
  negative    named with a warning, complaint or as a thing to avoid

Never add a brand that is not in the candidate list. If a candidate is not
really that brand, set isBrand false.`;

type JudgeVerdict = {
  id: string;
  isBrand: boolean;
  recommendation: Recommendation;
  sentiment: number;
  evidence?: string;
};

async function judge(answer: string, candidates: { id: string; surface: string; context: string }[]) {
  if (!llmProvider() || !candidates.length) return null;

  const parsed = await llmJson<{ brands: JudgeVerdict[] }>({
    system: JUDGE_SYSTEM,
    maxTokens: 900,
    temperature: 0,
    model: process.env.JUDGE_MODEL,
    user:
      `ANSWER:\n${answer.slice(0, 6000)}\n\n` +
      `CANDIDATES:\n${candidates.map(c => `- id=${c.id} matched="${c.surface}" context="${c.context.slice(0, 200)}"`).join('\n')}`,
  });

  return parsed && Array.isArray(parsed.brands) ? parsed.brands : null;
}

export async function extract(input: ExtractInput): Promise<ExtractResult> {
  const { answerText, citations, brands, ownDomain } = input;

  const withAliases = brands.map(b => ({ ...b, aliases: buildAliases(b) }));
  const own = withAliases[0];

  // Layer 1 — candidates
  const candidates = withAliases.flatMap(b => {
    const hits = findMentions(answerText, b.aliases);
    return hits.length ? [{ id: b.id, surface: hits[0].surface, context: hits[0].context }] : [];
  });

  // Layer 2 — adjudication
  let verdicts: JudgeVerdict[] | null = null;
  let degraded: string | undefined;
  try {
    verdicts = await judge(answerText, candidates);
    if (!verdicts) degraded = 'judge_unavailable';
  } catch (e) {
    degraded = `judge_error:${(e as Error).message.slice(0, 80)}`;
  }

  const verdictFor = (id: string) => verdicts?.find(v => v.id === id);
  const confirmedIds = new Set(
    candidates
      .filter(c => {
        const v = verdictFor(c.id);
        return v ? v.isBrand !== false : true; // no judge → trust layer 1
      })
      .map(c => c.id),
  );

  // Ranks are computed only over confirmed brands, so a vetoed false positive
  // does not push a real brand down the list.
  const ranks = rankBrands(
    answerText,
    withAliases.filter(b => confirmedIds.has(b.id)).map(b => ({ id: b.id, aliases: b.aliases })),
  );
  withAliases.forEach(b => { if (!(b.id in ranks)) ranks[b.id] = 0; });

  const citedDomains = extractDomains(answerText, citations);
  const ownKey = key(ownDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]);
  const cited = citedDomains.some(d => key(d) === ownKey || key(d).endsWith(ownKey));

  const ownVerdict = verdictFor(own.id);
  const mentioned = confirmedIds.has(own.id);

  const run: Run = {
    mentioned,
    rank: mentioned ? (ranks[own.id] || 0) : 0,
    cited,
    recommendation: mentioned ? (ownVerdict?.recommendation ?? 'neutral') : null,
    sentiment: mentioned ? clamp(ownVerdict?.sentiment ?? 0) : null,
  };

  return { run, ranks, citedDomains, confirmed: [...confirmedIds], degraded };
}

const clamp = (n: number) => Math.max(-1, Math.min(1, Number.isFinite(n) ? n : 0));

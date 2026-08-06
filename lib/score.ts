/**
 * score.ts — the visibility score, exactly as published on the marketing site.
 *
 *   S(p,e) = 100 × ( 0.30·m̄ + 0.22·π̄ + 0.20·c̄ + 0.18·ρ̄ + 0.10·σ̄ )
 *   VS     = Σ (w_p · w_e · S) / Σ (w_p · w_e)
 *   w_p    = √(volume) × intent multiplier
 *   CI₉₅   = ±1.96 · s / √n
 *
 * If you change a weight here, change it on the marketing page and in the
 * in-product methodology panel in the same commit. A score whose formula is
 * undocumented is not defensible to an agency's client, and that
 * defensibility is the product.
 */

export const WEIGHTS = {
  mention: 0.30,       // m — is the brand named at all
  prominence: 0.22,    // π — how early in the answer
  citation: 0.20,      // c — is our domain given as a source
  recommendation: 0.18,// ρ — actively recommended vs merely listed
  sentiment: 0.10,     // σ — tone of the mention
} as const;

export const INTENT_MULTIPLIER: Record<string, number> = {
  transactional: 1.5,
  brand_defence: 1.4,
  comparison: 1.3,
  evaluation: 1.1,
  informational: 0.8,
};

/** Default engine weights ≈ usage share. Overridable per workspace. */
export const ENGINE_WEIGHT: Record<string, number> = {
  chatgpt: 0.32,
  ai_overviews: 0.20,
  gemini: 0.14,
  perplexity: 0.10,
  claude: 0.09,
  copilot: 0.07,
  grok: 0.04,
  deepseek: 0.04,
};

export type Recommendation = 'primary' | 'listed' | 'neutral' | 'conditional' | 'negative';

const RECOMMENDATION_VALUE: Record<Recommendation, number> = {
  primary: 1.0,
  listed: 0.8,
  neutral: 0.5,
  conditional: 0.4,
  negative: 0.0,
};

/** One execution of one prompt against one engine. */
export interface Run {
  mentioned: boolean;
  /** 1 = first brand named. 0 = absent. */
  rank: number;
  cited: boolean;
  recommendation: Recommendation | null;
  /** −1 … +1 */
  sentiment: number | null;
}

export interface CellScore {
  score: number;
  ci: number;
  components: { m: number; pi: number; c: number; rho: number; sigma: number };
  runs: number;
  /** Mean rank across runs where the brand appeared; 0 if never. */
  meanRank: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1));
}

/** Prominence: 1st → 1.00, 2nd → 0.63, 4th → 0.43, absent → 0. */
export function prominence(rank: number): number {
  return rank > 0 ? 1 / Math.log2(1 + rank) : 0;
}

/**
 * Scores one prompt × engine cell from its R runs.
 * The CI is computed on the per-run score, not on the mention flag, so it
 * reflects total answer volatility rather than just presence flapping.
 */
export function scoreCell(runs: Run[]): CellScore {
  if (!runs.length) {
    return { score: 0, ci: 0, runs: 0, meanRank: 0,
      components: { m: 0, pi: 0, c: 0, rho: 0, sigma: 0 } };
  }

  const perRun = runs.map(r => {
    const m = r.mentioned ? 1 : 0;
    const pi = prominence(r.rank);
    const c = r.cited ? 1 : 0;
    const rho = r.mentioned && r.recommendation ? RECOMMENDATION_VALUE[r.recommendation] : 0;
    // Sentiment is only meaningful when the brand was actually mentioned.
    // A neutral 0.5 for absent runs would silently inflate the floor.
    const sigma = r.mentioned && r.sentiment !== null ? (r.sentiment + 1) / 2 : 0;
    return {
      m, pi, c, rho, sigma,
      score: 100 * (WEIGHTS.mention * m + WEIGHTS.prominence * pi + WEIGHTS.citation * c
        + WEIGHTS.recommendation * rho + WEIGHTS.sentiment * sigma),
    };
  });

  const scores = perRun.map(r => r.score);
  const ranked = runs.filter(r => r.rank > 0).map(r => r.rank);

  return {
    score: mean(scores),
    ci: 1.96 * stdev(scores) / Math.sqrt(runs.length),
    runs: runs.length,
    meanRank: ranked.length ? mean(ranked) : 0,
    components: {
      m: mean(perRun.map(r => r.m)),
      pi: mean(perRun.map(r => r.pi)),
      c: mean(perRun.map(r => r.c)),
      rho: mean(perRun.map(r => r.rho)),
      sigma: mean(perRun.map(r => r.sigma)),
    },
  };
}

export interface Cell {
  promptId: string;
  engineKey: string;
  intent: string;
  /** Estimated monthly demand for the prompt. */
  volume: number;
  result: CellScore;
}

export interface Aggregate {
  score: number;
  ci: number;
  /** True when the interval is too wide to act on. */
  lowConfidence: boolean;
  mentionRate: number;
  citationRate: number;
  byEngine: Record<string, { score: number; ci: number; mentions: number; cells: number }>;
}

export function promptWeight(volume: number, intent: string): number {
  // sqrt damping stops one huge informational prompt from owning the score.
  return Math.sqrt(Math.max(volume, 1)) * (INTENT_MULTIPLIER[intent] ?? 1);
}

export function aggregate(
  cells: Cell[],
  engineWeights: Record<string, number> = ENGINE_WEIGHT,
): Aggregate {
  if (!cells.length) {
    return { score: 0, ci: 0, lowConfidence: true, mentionRate: 0, citationRate: 0, byEngine: {} };
  }

  let num = 0, den = 0, varNum = 0;
  const byEngine: Aggregate['byEngine'] = {};

  for (const cell of cells) {
    const we = engineWeights[cell.engineKey] ?? 0;
    const wp = promptWeight(cell.volume, cell.intent);
    const w = we * wp;

    num += w * cell.result.score;
    den += w;
    // Variance of a weighted mean of independent estimates.
    varNum += (w * cell.result.ci / 1.96) ** 2;

    const e = (byEngine[cell.engineKey] ??= { score: 0, ci: 0, mentions: 0, cells: 0 });
    e.score += cell.result.score * wp;
    e.ci += (cell.result.ci * wp) ** 2;
    e.mentions += cell.result.components.m > 0 ? 1 : 0;
    e.cells += 1;
  }

  // Normalise per-engine aggregates by that engine's own prompt-weight total.
  for (const [k, e] of Object.entries(byEngine)) {
    const wsum = cells
      .filter(c => c.engineKey === k)
      .reduce((a, c) => a + promptWeight(c.volume, c.intent), 0) || 1;
    e.score = e.score / wsum;
    e.ci = Math.sqrt(e.ci) / wsum;
  }

  const score = den ? num / den : 0;
  const ci = den ? 1.96 * Math.sqrt(varNum) / den : 0;

  return {
    score,
    ci,
    lowConfidence: ci > 4,
    mentionRate: cells.filter(c => c.result.components.m > 0).length / cells.length * 100,
    citationRate: cells.filter(c => c.result.components.c > 0).length / cells.length * 100,
    byEngine,
  };
}

/**
 * Share of voice over the tracked brand set only.
 * The denominator must be the tracked set — using "all brands ever seen"
 * makes the number drift every time a model invents a new name.
 */
export function shareOfVoice(mentions: Record<string, number>): Record<string, number> {
  const total = Object.values(mentions).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(mentions)) out[id] = total ? (n / total) * 100 : 0;
  return out;
}

/**
 * Adaptive run count. Non-determinism is the whole reason we run R times,
 * but running 5 every time is expensive. If the first 3 runs agree, the
 * remaining 2 buy nothing.
 */
export function needsMoreRuns(runsSoFar: Run[], target = 5): boolean {
  if (runsSoFar.length >= target) return false;
  if (runsSoFar.length < 3) return true;
  const s = runsSoFar.map(r => scoreCell([r]).score);
  return stdev(s) > 6; // points of score
}

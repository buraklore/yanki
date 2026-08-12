import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  WEIGHTS, ENGINE_WEIGHT, prominence, scoreCell, aggregate, shareOfVoice,
  promptWeight, needsMoreRuns, type Run, type Cell,
} from '../lib/score';

const run = (o: Partial<Run> = {}): Run => ({
  mentioned: true, rank: 1, cited: true, recommendation: 'primary', sentiment: 1, ...o,
});

describe('engine weights', () => {
  it('sum to exactly 1 — the Platforms screen presents each as a % of the score', () => {
    const total = Object.values(ENGINE_WEIGHT).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it('match the seed in schema.sql — the two drifted once and nobody noticed', () => {
    const sqlText = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
    const block = sqlText.slice(sqlText.indexOf('insert into engines'));
    const seeded: Record<string, number> = {};
    for (const m of block.matchAll(/\('(\w+)',\s*'[^']+',\s*([\d.]+),/g)) {
      seeded[m[1]] = Number(m[2]);
    }
    // Same set of engines, same numbers, in both places.
    expect(Object.keys(seeded).sort()).toEqual(Object.keys(ENGINE_WEIGHT).sort());
    for (const [key, w] of Object.entries(ENGINE_WEIGHT)) {
      expect(seeded[key], `weight for ${key}`).toBeCloseTo(w, 9);
    }
  });
});

describe('weights', () => {
  it('sum to exactly 1 — otherwise the score is not on a 0–100 scale', () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('prominence', () => {
  it('matches the published curve', () => {
    expect(prominence(1)).toBeCloseTo(1.0, 3);
    expect(prominence(2)).toBeCloseTo(0.6309, 3);
    expect(prominence(4)).toBeCloseTo(0.4307, 3);
    expect(prominence(0)).toBe(0);
  });
  it('is monotonically decreasing', () => {
    for (let r = 1; r < 10; r++) expect(prominence(r)).toBeGreaterThan(prominence(r + 1));
  });
});

describe('scoreCell', () => {
  it('a perfect run scores 100', () => {
    expect(scoreCell([run()]).score).toBeCloseTo(100, 6);
  });
  it('an absent run scores 0', () => {
    const r = run({ mentioned: false, rank: 0, cited: false, recommendation: null, sentiment: null });
    expect(scoreCell([r]).score).toBe(0);
  });
  it('does not credit sentiment when the brand is absent', () => {
    // A naive (sentiment+1)/2 would hand out 5 free points to every miss.
    const r = run({ mentioned: false, rank: 0, cited: false, recommendation: null, sentiment: 0 });
    expect(scoreCell([r]).components.sigma).toBe(0);
    expect(scoreCell([r]).score).toBe(0);
  });
  it('negative sentiment scores below neutral sentiment', () => {
    const neg = scoreCell([run({ sentiment: -1 })]).score;
    const neu = scoreCell([run({ sentiment: 0 })]).score;
    expect(neg).toBeLessThan(neu);
  });
  it('being listed scores below being the primary recommendation', () => {
    expect(scoreCell([run({ recommendation: 'listed' })]).score)
      .toBeLessThan(scoreCell([run({ recommendation: 'primary' })]).score);
  });
  it('CI is zero when every run agrees', () => {
    expect(scoreCell([run(), run(), run()]).ci).toBeCloseTo(0, 10);
  });
  it('CI grows when runs disagree', () => {
    const mixed = scoreCell([
      run(),
      run({ mentioned: false, rank: 0, cited: false, recommendation: null, sentiment: null }),
      run(),
    ]);
    expect(mixed.ci).toBeGreaterThan(10);
    expect(mixed.score).toBeGreaterThan(0);
    expect(mixed.score).toBeLessThan(100);
  });
  it('mean rank ignores runs where the brand was absent', () => {
    const c = scoreCell([run({ rank: 2 }), run({ mentioned: false, rank: 0 }), run({ rank: 4 })]);
    expect(c.meanRank).toBeCloseTo(3, 6);
  });
  it('handles an empty run list without throwing', () => {
    expect(scoreCell([]).score).toBe(0);
  });
});

describe('promptWeight', () => {
  it('applies sqrt damping so one huge prompt cannot own the score', () => {
    // 100x the volume must not be 100x the weight.
    const small = promptWeight(100, 'evaluation');
    const huge = promptWeight(10_000, 'evaluation');
    expect(huge / small).toBeCloseTo(10, 6);
  });
  it('weights transactional above informational', () => {
    expect(promptWeight(1000, 'transactional')).toBeGreaterThan(promptWeight(1000, 'informational'));
  });
  it('never returns zero for a zero-volume prompt', () => {
    expect(promptWeight(0, 'evaluation')).toBeGreaterThan(0);
  });
});

const cell = (o: Partial<Cell> & { runs: Run[] }): Cell => ({
  promptId: o.promptId ?? 'p1',
  engineKey: o.engineKey ?? 'chatgpt',
  intent: o.intent ?? 'evaluation',
  volume: o.volume ?? 1000,
  result: scoreCell(o.runs),
});

describe('aggregate', () => {
  it('returns 0 and low confidence for no data', () => {
    const a = aggregate([]);
    expect(a.score).toBe(0);
    expect(a.lowConfidence).toBe(true);
  });
  it('a perfect grid scores 100', () => {
    const cells = ['chatgpt', 'gemini', 'perplexity'].map(e => cell({ engineKey: e, runs: [run(), run()] }));
    expect(aggregate(cells).score).toBeCloseTo(100, 6);
  });
  it('weights the high-share engine more heavily', () => {
    const perfect = [run(), run()];
    const absent = [run({ mentioned: false, rank: 0, cited: false, recommendation: null, sentiment: null })];
    // Strong on ChatGPT (0.32), absent on Grok (0.04)
    const strongOnBig = aggregate([
      cell({ engineKey: 'chatgpt', runs: perfect }),
      cell({ engineKey: 'grok', runs: absent }),
    ]).score;
    // The mirror image
    const strongOnSmall = aggregate([
      cell({ engineKey: 'chatgpt', runs: absent }),
      cell({ engineKey: 'grok', runs: perfect }),
    ]).score;
    expect(strongOnBig).toBeGreaterThan(strongOnSmall);
  });
  it('flags low confidence when the interval is wide', () => {
    const flappy = [run(), run({ mentioned: false, rank: 0, cited: false, recommendation: null, sentiment: null })];
    expect(aggregate([cell({ runs: flappy })]).lowConfidence).toBe(true);
  });
  it('computes mention and citation rates over cells', () => {
    const a = aggregate([
      cell({ promptId: 'p1', runs: [run()] }),
      cell({ promptId: 'p2', runs: [run({ mentioned: false, rank: 0, cited: false, recommendation: null, sentiment: null })] }),
    ]);
    expect(a.mentionRate).toBeCloseTo(50, 6);
    expect(a.citationRate).toBeCloseTo(50, 6);
  });
  it('per-engine breakdown stays on a 0–100 scale', () => {
    const a = aggregate([
      cell({ engineKey: 'chatgpt', promptId: 'p1', volume: 100, runs: [run()] }),
      cell({ engineKey: 'chatgpt', promptId: 'p2', volume: 9000, runs: [run()] }),
    ]);
    expect(a.byEngine.chatgpt.score).toBeGreaterThan(99.9);
    expect(a.byEngine.chatgpt.score).toBeLessThanOrEqual(100.0001);
  });
  it('ignores engines with zero weight', () => {
    const a = aggregate([cell({ engineKey: 'chatgpt', runs: [run()] })], { chatgpt: 0 });
    expect(a.score).toBe(0);
  });
});

describe('shareOfVoice', () => {
  it('sums to 100', () => {
    const s = shareOfVoice({ self: 12, a: 30, b: 8 });
    expect(Object.values(s).reduce((x, y) => x + y, 0)).toBeCloseTo(100, 6);
  });
  it('returns zeros rather than NaN when nobody was mentioned', () => {
    const s = shareOfVoice({ self: 0, a: 0 });
    expect(s.self).toBe(0);
    expect(Number.isNaN(s.a)).toBe(false);
  });
});

describe('needsMoreRuns — cost control', () => {
  it('always wants the first three', () => {
    expect(needsMoreRuns([])).toBe(true);
    expect(needsMoreRuns([run(), run()])).toBe(true);
  });
  it('stops at three when the runs agree', () => {
    expect(needsMoreRuns([run(), run(), run()])).toBe(false);
  });
  it('buys more when the runs disagree', () => {
    const absent = run({ mentioned: false, rank: 0, cited: false, recommendation: null, sentiment: null });
    expect(needsMoreRuns([run(), absent, run()])).toBe(true);
  });
  it('never exceeds the target', () => {
    expect(needsMoreRuns([run(), run(), run(), run(), run()], 5)).toBe(false);
  });
});

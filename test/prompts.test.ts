import { describe, it, expect } from 'vitest';
import { generatePrompts, checkMix, estimateVolume, opportunityScore, TARGET_MIX } from '../lib/prompts';

const ctx = {
  brandName: 'Acme Commerce', sector: 'E-commerce & Retail', sectorTerm: 'e-ticaret',
  country: 'Türkiye', city: 'İstanbul', language: 'tr' as const,
};

describe('generatePrompts', () => {
  it('produces a set covering every intent', () => {
    const p = generatePrompts(ctx);
    const intents = new Set(p.map(x => x.intent));
    expect([...intents].sort()).toEqual(
      ['brand_defence', 'comparison', 'evaluation', 'informational', 'transactional']);
  });
  it('is deterministic for the same input', () => {
    expect(generatePrompts(ctx)).toEqual(generatePrompts(ctx));
  });
  it('adds a city prompt only when a city is given', () => {
    expect(generatePrompts(ctx).length).toBe(generatePrompts({ ...ctx, city: null }).length + 1);
  });
  it('interpolates the brand name into the brand-defence prompt', () => {
    const bd = generatePrompts(ctx).find(p => p.intent === 'brand_defence')!;
    expect(bd.text).toContain('Acme Commerce');
  });
  it('switches language', () => {
    expect(generatePrompts({ ...ctx, language: 'en' })[0].text).toMatch(/^What is/);
  });
  it('gives every prompt a positive volume', () => {
    expect(generatePrompts(ctx).every(p => p.volume > 0)).toBe(true);
  });
});

describe('checkMix', () => {
  it('accepts the generated set', () => {
    expect(checkMix(generatePrompts(ctx)).balanced).toBe(true);
  });
  it('warns when brand defence is missing', () => {
    const r = checkMix(generatePrompts(ctx).filter(p => p.intent !== 'brand_defence'));
    expect(r.balanced).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/brand-defence/i);
  });
  it('warns on an all-evaluation set — the classic mistake', () => {
    const r = checkMix(Array.from({ length: 20 }, () => ({ intent: 'evaluation' as const })));
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });
  it('target mix sums to 1', () => {
    expect(Object.values(TARGET_MIX).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe('estimateVolume', () => {
  it('falls back to the base when no signals are available', () => {
    expect(estimateVolume(800)).toBe(800);
  });
  it('damps search volume with a square root', () => {
    const a = estimateVolume(0, { searchVolume: 1_000 });
    const b = estimateVolume(0, { searchVolume: 100_000 });
    expect(b / a).toBeCloseTo(10, 1); // 100x searches → 10x index
  });
  it('never returns below the floor', () => {
    expect(estimateVolume(0, { searchVolume: 1 })).toBeGreaterThanOrEqual(50);
  });
});

describe('opportunityScore', () => {
  const base = { coverage: 0.5, volume: 1000, sourceCount: 6, fit: 'medium' as const, intent: 'evaluation' as const };
  it('stays inside 0…100', () => {
    expect(opportunityScore({ ...base, coverage: 0 }).valueOf()).toBeLessThanOrEqual(100);
    expect(opportunityScore({ ...base, coverage: 1, volume: 50, sourceCount: 12, fit: 'low' })).toBeGreaterThanOrEqual(0);
  });
  it('rates an uncovered prompt above a covered one', () => {
    expect(opportunityScore({ ...base, coverage: 0 }))
      .toBeGreaterThan(opportunityScore({ ...base, coverage: 1 }));
  });
  it('rates an uncrowded answer above a crowded one', () => {
    expect(opportunityScore({ ...base, sourceCount: 1 }))
      .toBeGreaterThan(opportunityScore({ ...base, sourceCount: 12 }));
  });
  it('rates transactional above informational, all else equal', () => {
    expect(opportunityScore({ ...base, intent: 'transactional' }))
      .toBeGreaterThan(opportunityScore({ ...base, intent: 'informational' }));
  });
});

import { describe, it, expect } from 'vitest';
import { cleanVariants, variantReport, VARIANT_TARGET, type VariantCell } from '../lib/variants';

/* ---- cleanVariants ---------------------------------------------------- */

describe('cleanVariants', () => {
  const orig = 'türkiye\'de en iyi muhasebe yazılımları hangileri?';

  it('drops the original phrasing and folded duplicates', () => {
    const out = cleanVariants([
      "Türkiye'de en iyi muhasebe yazılımları hangileri?",   // = original
      'en iyi muhasebe programı hangisi',
      'EN İYİ MUHASEBE PROGRAMI HANGİSİ',                     // dup after folding
      'hangi muhasebe yazılımını önerirsiniz',
    ], orig);
    expect(out).toEqual([
      'en iyi muhasebe programı hangisi',
      'hangi muhasebe yazılımını önerirsiniz',
    ]);
  });

  it('bounds length and caps the count', () => {
    const many = Array.from({ length: 15 }, (_, i) => `muhasebe programı önerisi varyant ${i}`);
    const out = cleanVariants(['kısa', 'x'.repeat(250), ...many], orig);
    expect(out).toHaveLength(VARIANT_TARGET);
    expect(out.every(v => v.length >= 8 && v.length <= 200)).toBe(true);
  });

  it('normalises whitespace, quotes and case', () => {
    const out = cleanVariants(['  "En  iyi   ön muhasebe programı"  '], orig);
    expect(out).toEqual(['en iyi ön muhasebe programı']);
  });
});

/* ---- variantReport ---------------------------------------------------- */

describe('variantReport', () => {
  const cell = (v: string, e: string, m: boolean, rank: number | null = null): VariantCell =>
    ({ variantId: v, engineKey: e, mentioned: m, rank });

  it('computes robustness over measured cells only', () => {
    const r = variantReport([
      cell('v1', 'chatgpt', true, 1), cell('v1', 'gemini', false),
      cell('v2', 'chatgpt', true, 3), cell('v2', 'gemini', true, 2),
    ]);
    expect(r.measured).toBe(4);
    expect(r.mentionedCells).toBe(3);
    expect(r.robustness).toBeCloseTo(75, 6);
    expect(r.byVariant.v1).toEqual({ measured: 2, mentioned: 1 });
    expect(r.byEngine.gemini).toEqual({ measured: 2, mentioned: 1 });
  });

  it('returns zeros for an empty test instead of NaN', () => {
    const r = variantReport([]);
    expect(r.robustness).toBe(0);
    expect(r.measured).toBe(0);
  });
});

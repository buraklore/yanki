import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AUDIT_CRITERIA } from '../lib/audit';

/**
 * "58 kriter" is a promise made on the marketing page and repeated in the
 * product. Counting the checks by hand once produced 49 — a grep that missed
 * the ten array-driven ones — so the count is pinned here instead.
 */
describe('audit criteria count', () => {
  const src = readFileSync(new URL('../lib/audit.ts', import.meta.url), 'utf8');

  it('matches the number of checks actually registered', () => {
    // Checks written out one per line, each with a literal key.
    const direct = [...src.matchAll(/^\s*add\(\s*CAT_\w/gm)].length;
    // Plus the structured-data set, which is a table fed through forEach.
    const viaArray = [...src.matchAll(/^\s*\['[a-z0-9_]+',\s*'[^']+',/gm)].length;
    expect(direct + viaArray).toBe(AUDIT_CRITERIA);
  });

  it('is the number the UI and the marketing page quote', () => {
    // Only claims about the audit. "278 / 672 checks" elsewhere counts scan
    // runs (prompt × engine × repeat), which is a different quantity entirely.
    // Marketing says "58+ faktör"; the product says "58 kriter". Both are
    // claims about audit size and both must track the constant.
    const audit = /(\d+)\+?\s*(kriter|faktör|FAKTÖR|technical checks|checks on your website|factors scored)/g;
    for (const file of ['../public/app.html', '../public/marketing.html']) {
      const page = readFileSync(new URL(file, import.meta.url), 'utf8');
      const claims = [...page.matchAll(audit)];
      expect(claims.length, `no audit-size claim found in ${file}`).toBeGreaterThan(0);
      for (const m of claims) {
        expect(Number(m[1]), `"${m[0]}" in ${file}`).toBe(AUDIT_CRITERIA);
      }
    }
  });
});

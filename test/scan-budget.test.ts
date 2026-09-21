import { describe, it, expect } from 'vitest';
import { JUDGE_RESERVE_MS, MIN_ASK_MS } from '../lib/scan';
import { JUDGE_TIMEOUT_MS } from '../lib/extract';

/* The v6 outage class, pinned: a per-job reserve smaller than the judge's
 * own ceiling lets an edge-admitted job outlive its invocation, Vercel kills
 * the function, and a scan freezes while looking alive. These relations are
 * the contract between extract.ts and scan.ts. */
describe('queue time budget contract', () => {
  it('reserve strictly exceeds the judge timeout', () => {
    expect(JUDGE_RESERVE_MS).toBeGreaterThan(JUDGE_TIMEOUT_MS);
  });
  it('a first-started job in a 52s budget gets a wide ask window (>=30s)', () => {
    const askMs = Math.min(35_000, 52_000 - JUDGE_RESERVE_MS);
    expect(askMs).toBeGreaterThanOrEqual(30_000);
  });
  it('lane admission leaves room for a minimal attempt plus the reserve', () => {
    expect(MIN_ASK_MS + JUDGE_RESERVE_MS).toBeLessThanOrEqual(21_000);
  });
});

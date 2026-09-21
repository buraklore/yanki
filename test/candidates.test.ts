import { describe, it, expect } from 'vitest';
import { extractCitations, extractDomains } from '../lib/entity';
import { filterCandidateNames } from '../lib/extract';

/* ---- extractCitations (§15 — page-level citations) ------------------ */

describe('extractCitations', () => {
  it('keeps one row per domain with the first page URL as representative', () => {
    const answer =
      'Bkz https://ornek.com/muhasebe-rehberi ve https://ornek.com/fiyatlar, ' +
      'ayrıca https://rakip.com.tr/urunler.';
    const rows = extractCitations(answer);
    expect(rows).toHaveLength(2);
    const ornek = rows.find(r => r.domain === 'ornek.com')!;
    expect(ornek.url).toBe('https://ornek.com/muhasebe-rehberi');
    expect(rows.find(r => r.domain === 'rakip.com.tr')!.url)
      .toBe('https://rakip.com.tr/urunler');
  });

  it('stores null for bare-hostname citations — no page information exists', () => {
    const rows = extractCitations('Kaynak: https://ornek.com/');
    expect(rows).toEqual([{ domain: 'ornek.com', url: null }]);
  });

  it('prefers structured citations over inline URLs and strips www', () => {
    const rows = extractCitations('Metinde https://www.ornek.com/b geçiyor.', [
      { url: 'https://www.ornek.com/a?x=1' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].domain).toBe('ornek.com');
    expect(rows[0].url).toBe('https://www.ornek.com/a?x=1');
  });

  it('ignores malformed URLs without dropping the good ones', () => {
    const rows = extractCitations('https://iyi.com/sayfa ve https://[bozuk', []);
    expect(rows.map(r => r.domain)).toContain('iyi.com');
  });

  it('extractDomains stays a compatible projection of extractCitations', () => {
    const answer = 'https://a.com/x https://b.com/y';
    expect(extractDomains(answer)).toEqual(extractCitations(answer).map(c => c.domain));
  });
});

/* ---- filterCandidateNames (§12 — potential competitors) -------------- */

describe('filterCandidateNames', () => {
  const known = new Set(['accurate', 'logo']);

  it('drops brands already tracked, in any casing or spacing', () => {
    expect(filterCandidateNames(['Accurate', 'LOGO', 'Mikro'], known)).toEqual(['Mikro']);
  });

  it('drops AI platforms, generic words and non-names', () => {
    const out = filterCandidateNames(
      ['ChatGPT', 'Google', 'AI', 'x', '12345',
       'bu bir marka adı değil uzun bir cümledir tamamen', 'Paraşüt'],
      known,
    );
    expect(out).toEqual(['Paraşüt']);
  });

  it('de-duplicates on the folded key so spelling variants collapse', () => {
    expect(filterCandidateNames(['Paraşüt', 'Parasut', 'paraşüt'], known)).toEqual(['Paraşüt']);
  });

  it('caps the list at 8 names', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Marka${i}Adi`);
    expect(filterCandidateNames(many, known)).toHaveLength(8);
  });
});

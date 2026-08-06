import { describe, it, expect } from 'vitest';
import { fold, key, buildAliases, findMentions, rankBrands, extractDomains } from '../lib/entity';

describe('fold — Turkish casing', () => {
  it('collapses dotted and dotless i onto plain i', () => {
    expect(fold('İSTANBUL')).toBe('istanbul');
    expect(fold('Istanbul')).toBe('istanbul');
    expect(fold('ıstanbul')).toBe('istanbul');
    expect(fold('İstanbul')).toBe('istanbul');
  });
  it('strips Turkish diacritics', () => {
    expect(fold('Şişli Öğüt Çağrı Üründeğer')).toBe('sisli ogut cagri urundeger');
  });
  it('never emits a combining dot (the default toLowerCase bug)', () => {
    expect(fold('İ')).not.toMatch(/\u0307/);
  });
});

describe('buildAliases', () => {
  it('derives the diacritic-free spelling and the initialism', () => {
    const a = buildAliases({ name: 'Türk Hava Yolları', domain: 'turkishairlines.com' });
    expect(a).toContain('Turk Hava Yollari');
    expect(a).toContain('THY');
    expect(a).toContain('TürkHavaYolları');
    expect(a).toContain('turkishairlines.com');
    expect(a).toContain('turkishairlines');
  });
  it('keeps operator-supplied variants', () => {
    const a = buildAliases({ name: 'Acme', variants: ['Acme Co', 'ACME Ltd'] });
    expect(a).toContain('Acme Co');
  });
  it('drops aliases that are too short or generic', () => {
    const a = buildAliases({ name: 'AI App' });
    expect(a).not.toContain('ai');
    expect(a).not.toContain('app');
  });
  it('does not build an initialism from a single word', () => {
    const a = buildAliases({ name: 'Bynogame' });
    expect(a).not.toContain('B');
  });
});

describe('findMentions — suffixes', () => {
  const aliases = buildAliases({ name: 'Zeytin CRM', domain: 'zeytincrm.com' });

  it('matches the bare form', () => {
    expect(findMentions('Zeytin CRM iyi bir seçenek.', aliases)).toHaveLength(1);
  });
  it('matches apostrophe suffixes', () => {
    expect(findMentions("Zeytin CRM'in fiyatları uygun.", aliases)).toHaveLength(1);
    expect(findMentions("Zeytin CRM'i denedim.", aliases)).toHaveLength(1);
  });
  it('matches the diacritic-free and spaceless spellings', () => {
    expect(findMentions('ZeytinCRM kullanıyoruz.', aliases)).toHaveLength(1);
  });
  it('matches the domain form', () => {
    expect(findMentions('Detaylar zeytincrm.com adresinde.', aliases).length).toBeGreaterThan(0);
  });
  it('is case and dot-i insensitive', () => {
    expect(findMentions('ZEYTİN CRM en iyisi.', aliases)).toHaveLength(1);
  });
});

describe('findMentions — false positives', () => {
  it('does not match a longer unrelated word', () => {
    const aliases = buildAliases({ name: 'Norma' });
    expect(findMentions('Bu tamamen normal bir durum.', aliases)).toHaveLength(0);
    expect(findMentions('Normandiya çıkarması.', aliases)).toHaveLength(0);
  });
  it('still matches the brand with a legal suffix', () => {
    const aliases = buildAliases({ name: 'Norma' });
    expect(findMentions("Norma'nın fiyatı iyi.", aliases)).toHaveLength(1);
  });
  it('does not match inside another domain', () => {
    const aliases = buildAliases({ name: 'Acme', domain: 'acme.com' });
    expect(findMentions('See notacme.com for details.', aliases)).toHaveLength(0);
  });
  it('de-duplicates overlapping aliases at one position', () => {
    const aliases = buildAliases({ name: 'Zeytin CRM', domain: 'zeytincrm.com' });
    // "Zeytin CRM" and "ZeytinCRM" both fold near the same span
    expect(findMentions('Zeytin CRM', aliases)).toHaveLength(1);
  });
});

describe('rankBrands', () => {
  const brands = [
    { id: 'self', aliases: buildAliases({ name: 'Zeytin CRM' }) },
    { id: 'a', aliases: buildAliases({ name: 'Bulut CRM' }) },
    { id: 'b', aliases: buildAliases({ name: 'Pikselo' }) },
  ];
  it('ranks by first appearance', () => {
    const r = rankBrands('Bulut CRM, Pikselo ve Zeytin CRM öne çıkıyor.', brands);
    expect(r).toEqual({ self: 3, a: 1, b: 2 });
  });
  it('gives 0 to brands that never appear', () => {
    const r = rankBrands('Sadece Pikselo var.', brands);
    expect(r.self).toBe(0);
    expect(r.b).toBe(1);
  });
});

describe('extractDomains', () => {
  it('pulls hosts from bare urls and structured citations', () => {
    const d = extractDomains('Bkz https://www.webrazzi.com/haber?x=1 ve https://eksisozluk.com/x',
      [{ url: 'https://youtube.com/watch?v=1' }]);
    expect(d.sort()).toEqual(['eksisozluk.com', 'webrazzi.com', 'youtube.com']);
  });
  it('ignores malformed urls', () => {
    expect(extractDomains('http://', [])).toEqual([]);
  });
});

describe('key', () => {
  it('produces a stable comparison key across spellings', () => {
    expect(key('ByNoGame.com')).toBe(key('bynogame.com'));
    expect(key("Türk Hava Yolları")).toBe(key('turkhavayollari'));
  });
});

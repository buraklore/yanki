/**
 * Sector list shared by the onboarding UI and the prompt generator.
 * `term` is the phrase that reads naturally inside a question, which is why
 * it is not simply a lowercase of the label.
 */
export interface Sector { key: string; label: string; termTr: string; termEn: string }

export const SECTORS: Sector[] = [
  { key: 'tech',      label: 'Teknoloji & Bilişim',    termTr: 'teknoloji ve IT',        termEn: 'technology and IT' },
  { key: 'gaming',    label: 'Oyun & Dijital Kod',     termTr: 'oyun ve e-pin',          termEn: 'gaming and digital top-up' },
  { key: 'ecommerce', label: 'E-ticaret & Perakende',  termTr: 'e-ticaret',              termEn: 'e-commerce' },
  { key: 'finance',   label: 'Finans & Sigorta',       termTr: 'finans ve sigorta',      termEn: 'finance and insurance' },
  { key: 'health',    label: 'Sağlık',                 termTr: 'sağlık',                 termEn: 'healthcare' },
  { key: 'travel',    label: 'Turizm & Konaklama',     termTr: 'turizm ve konaklama',    termEn: 'travel and hospitality' },
  { key: 'education', label: 'Eğitim',                 termTr: 'eğitim',                 termEn: 'education' },
  { key: 'auto',      label: 'Otomotiv',               termTr: 'otomotiv',               termEn: 'automotive' },
  { key: 'realestate',label: 'Gayrimenkul & İnşaat',   termTr: 'gayrimenkul',            termEn: 'real estate' },
  { key: 'logistics', label: 'Lojistik & Kargo',       termTr: 'lojistik ve kargo',      termEn: 'logistics and shipping' },
  { key: 'food',      label: 'Gıda & Restoran',        termTr: 'gıda ve restoran',       termEn: 'food and restaurants' },
  { key: 'legal',     label: 'Hukuk & Danışmanlık',    termTr: 'hukuk ve danışmanlık',   termEn: 'legal and consulting' },
  { key: 'other',     label: 'Diğer',                  termTr: 'hizmet',                 termEn: 'services' },
];

export const COUNTRIES = [
  { code: 'TR', name: 'Turkey',         nameTr: 'Türkiye',            lang: 'tr' },
  { code: 'DE', name: 'Germany',        nameTr: 'Almanya',            lang: 'de' },
  { code: 'GB', name: 'United Kingdom', nameTr: 'Birleşik Krallık',   lang: 'en' },
  { code: 'US', name: 'United States',  nameTr: 'ABD',                lang: 'en' },
  { code: 'NL', name: 'Netherlands',    nameTr: 'Hollanda',           lang: 'nl' },
  { code: 'AE', name: 'UAE',            nameTr: 'BAE',                lang: 'ar' },
];

export function sectorByLabel(label: string): Sector {
  return SECTORS.find(s => s.label === label || s.key === label) ?? SECTORS[SECTORS.length - 1];
}

/** Normalises whatever the user typed into a usable https origin. */
export function normaliseDomain(input: string): string {
  let v = (input || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.hostname}`.toLowerCase();
  } catch {
    return '';
  }
}

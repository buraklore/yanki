/**
 * Sector list shared by the onboarding UI and the prompt generator.
 * `term` is the phrase that reads naturally inside a question, which is why
 * it is not simply a lowercase of the label.
 */
export interface Sector { key: string; label: string; termTr: string; termEn: string }

export const SECTORS: Sector[] = [
  // Teknoloji
  { key: 'software',    label: 'Yazılım & SaaS',            termTr: 'yazılım ve SaaS',            termEn: 'software and SaaS' },
  { key: 'tech',        label: 'Teknoloji & Bilişim',       termTr: 'teknoloji ve IT',            termEn: 'technology and IT' },
  { key: 'agency_dig',  label: 'Dijital Ajans & Pazarlama', termTr: 'dijital pazarlama ajansı',   termEn: 'digital marketing agency' },
  { key: 'telecom',     label: 'Telekomünikasyon',          termTr: 'telekomünikasyon',           termEn: 'telecommunications' },
  { key: 'hosting',     label: 'Hosting & Bulut',           termTr: 'hosting ve bulut',           termEn: 'hosting and cloud' },
  { key: 'cyber',       label: 'Siber Güvenlik',            termTr: 'siber güvenlik',             termEn: 'cybersecurity' },
  { key: 'electronics', label: 'Elektronik & Beyaz Eşya',   termTr: 'elektronik ve beyaz eşya',   termEn: 'electronics and appliances' },
  { key: 'gaming',      label: 'Oyun & Dijital Kod',        termTr: 'oyun ve e-pin',              termEn: 'gaming and digital top-up' },

  // Ticaret
  { key: 'ecommerce',   label: 'E-ticaret & Perakende',     termTr: 'e-ticaret',                  termEn: 'e-commerce' },
  { key: 'marketplace', label: 'Pazaryeri',                 termTr: 'pazaryeri',                  termEn: 'online marketplace' },
  { key: 'fashion',     label: 'Moda & Giyim',              termTr: 'moda ve giyim',              termEn: 'fashion and apparel' },
  { key: 'cosmetics',   label: 'Kozmetik & Kişisel Bakım',  termTr: 'kozmetik ve kişisel bakım',  termEn: 'cosmetics and personal care' },
  { key: 'jewellery',   label: 'Mücevher & Saat',           termTr: 'mücevher ve saat',           termEn: 'jewellery and watches' },
  { key: 'furniture',   label: 'Mobilya & Dekorasyon',      termTr: 'mobilya ve dekorasyon',      termEn: 'furniture and home decor' },
  { key: 'baby',        label: 'Anne & Bebek',              termTr: 'anne ve bebek ürünleri',     termEn: 'baby and maternity' },
  { key: 'pet',         label: 'Evcil Hayvan',              termTr: 'evcil hayvan ürünleri',      termEn: 'pet supplies' },
  { key: 'sports',      label: 'Spor & Outdoor',            termTr: 'spor ve outdoor',            termEn: 'sports and outdoor' },

  // Finans
  { key: 'finance',     label: 'Finans & Sigorta',          termTr: 'finans ve sigorta',          termEn: 'finance and insurance' },
  { key: 'banking',     label: 'Bankacılık',                termTr: 'bankacılık',                 termEn: 'banking' },
  { key: 'fintech',     label: 'Fintek & Ödeme',            termTr: 'fintek ve ödeme sistemleri', termEn: 'fintech and payments' },
  { key: 'crypto',      label: 'Kripto & Borsa',            termTr: 'kripto para ve yatırım',     termEn: 'crypto and investing' },
  { key: 'accounting',  label: 'Muhasebe & Mali Müşavirlik',termTr: 'muhasebe ve mali müşavirlik',termEn: 'accounting and tax advisory' },

  // Sağlık
  { key: 'health',      label: 'Sağlık',                    termTr: 'sağlık',                     termEn: 'healthcare' },
  { key: 'hospital',    label: 'Hastane & Klinik',          termTr: 'hastane ve klinik',          termEn: 'hospitals and clinics' },
  { key: 'dental',      label: 'Diş Sağlığı',               termTr: 'diş kliniği',                termEn: 'dental care' },
  { key: 'aesthetic',   label: 'Estetik & Saç Ekimi',       termTr: 'estetik ve saç ekimi',       termEn: 'aesthetics and hair transplant' },
  { key: 'pharma',      label: 'İlaç & Medikal',            termTr: 'ilaç ve medikal',            termEn: 'pharmaceuticals and medical devices' },
  { key: 'fitness',     label: 'Fitness & Wellness',        termTr: 'fitness ve wellness',        termEn: 'fitness and wellness' },

  // Gayrimenkul & yapı
  { key: 'realestate',  label: 'Gayrimenkul & İnşaat',      termTr: 'gayrimenkul',                termEn: 'real estate' },
  { key: 'developer',   label: 'Konut Geliştirme',          termTr: 'konut projeleri',            termEn: 'residential development' },
  { key: 'valuation',   label: 'Gayrimenkul Değerleme',     termTr: 'gayrimenkul değerleme',      termEn: 'property valuation' },
  { key: 'architect',   label: 'Mimarlık & Tasarım',        termTr: 'mimarlık',                   termEn: 'architecture and design' },
  { key: 'construct',   label: 'Yapı Malzemeleri',          termTr: 'yapı malzemeleri',           termEn: 'building materials' },

  // Sanayi
  { key: 'manufact',    label: 'Üretim & Sanayi',           termTr: 'üretim ve sanayi',           termEn: 'manufacturing and industry' },
  { key: 'energy',      label: 'Enerji & Yenilenebilir',    termTr: 'enerji',                     termEn: 'energy and renewables' },
  { key: 'chemical',    label: 'Kimya & Plastik',           termTr: 'kimya ve plastik',           termEn: 'chemicals and plastics' },
  { key: 'agri',        label: 'Tarım & Hayvancılık',       termTr: 'tarım',                      termEn: 'agriculture' },
  { key: 'textile',     label: 'Tekstil & Konfeksiyon',     termTr: 'tekstil',                    termEn: 'textiles' },
  { key: 'machinery',   label: 'Makine & Ekipman',          termTr: 'makine ve ekipman',          termEn: 'machinery and equipment' },

  // Ulaşım
  { key: 'auto',        label: 'Otomotiv',                  termTr: 'otomotiv',                   termEn: 'automotive' },
  { key: 'rentacar',    label: 'Araç Kiralama',             termTr: 'araç kiralama',              termEn: 'car rental' },
  { key: 'logistics',   label: 'Lojistik & Kargo',          termTr: 'lojistik ve kargo',          termEn: 'logistics and shipping' },
  { key: 'aviation',    label: 'Havacılık',                 termTr: 'havacılık',                  termEn: 'aviation' },

  // Hizmet
  { key: 'travel',      label: 'Turizm & Konaklama',        termTr: 'turizm ve konaklama',        termEn: 'travel and hospitality' },
  { key: 'hotel',       label: 'Otel & Tatil Köyü',         termTr: 'otel',                       termEn: 'hotels and resorts' },
  { key: 'food',        label: 'Gıda & Restoran',           termTr: 'gıda ve restoran',           termEn: 'food and restaurants' },
  { key: 'catering',    label: 'Catering & Toplu Yemek',    termTr: 'catering',                   termEn: 'catering' },
  { key: 'education',   label: 'Eğitim',                    termTr: 'eğitim',                     termEn: 'education' },
  { key: 'university',  label: 'Üniversite & Yükseköğretim',termTr: 'üniversite',                 termEn: 'higher education' },
  { key: 'language',    label: 'Yurtdışı Eğitim & Dil',     termTr: 'yurtdışı eğitim',            termEn: 'study abroad and language schools' },
  { key: 'legal',       label: 'Hukuk & Danışmanlık',       termTr: 'hukuk ve danışmanlık',       termEn: 'legal and consulting' },
  { key: 'hr',          label: 'İnsan Kaynakları & İstihdam',termTr: 'insan kaynakları',          termEn: 'HR and recruitment' },
  { key: 'security',    label: 'Güvenlik & Temizlik',       termTr: 'güvenlik ve temizlik hizmetleri', termEn: 'security and facility services' },
  { key: 'event',       label: 'Etkinlik & Organizasyon',   termTr: 'etkinlik ve organizasyon',   termEn: 'events and organisation' },
  { key: 'media',       label: 'Medya & Yayıncılık',        termTr: 'medya ve yayıncılık',        termEn: 'media and publishing' },
  { key: 'entertain',   label: 'Eğlence & Prodüksiyon',     termTr: 'eğlence ve prodüksiyon',     termEn: 'entertainment and production' },
  { key: 'nonprofit',   label: 'Dernek & Vakıf',            termTr: 'sivil toplum',               termEn: 'nonprofit organisations' },
  { key: 'public',      label: 'Kamu & Belediye',           termTr: 'kamu hizmetleri',            termEn: 'public sector' },

  { key: 'other',       label: 'Diğer',                     termTr: 'hizmet',                     termEn: 'services' },
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

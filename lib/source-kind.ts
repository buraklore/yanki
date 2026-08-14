import { sql } from '@/lib/db';
import { llmJson } from '@/lib/llm';
import { safeFetch } from '@/lib/safe-fetch';

/**
 * source-kind.ts — bir kaynak alan adına nasıl girilir?
 *
 * Aksiyon planı, bir markanın hangi kaynaklarda görünmediğini söyler. Bunun
 * işe yaraması için "oraya nasıl girilir" sorusunun cevabının doğru olması
 * gerekir, ve bu cevap alan adına göre kökten değişir:
 *
 *   clutch.co    → profil açarsınız, aynı gün
 *   semrush.com  → giremezsiniz; orası bir SaaS şirketinin kendi blogu
 *
 * Eskiden ikisine de aynı tavsiye veriliyordu ("editörlerine ulaşın"). Gerçek
 * müşteri verisinde ölçtük: 23 kaynağın 11'i (490 atfın %40'ı) girilemez
 * sınıfta, dokuzu doğrudan rakip ajans siteleri. Yani tavsiyelerin kırkta biri
 * değil, kırk yüzdesi geçersizdi.
 *
 * Sınıflandırma sırası ve gerekçesi:
 *
 *   1. Rakip listesi   — müşteri zaten söylemiş, sormaya gerek yok
 *   2. Kendi alan adı  — aynı
 *   3. Ortak önbellek  — alan adları müşteriler arası yoğun tekrar eder
 *   4. Çekirdek liste  — elle doğrulanmış ~68 kayıt
 *   5. Model           — sayfa başlığı + meta açıklama ile
 *   6. unknown         — emin değilse SUSAR, kullanıcıya sorar
 *
 * Sayfa içeriğinden regex ile sinyal çıkarma katmanı denendi ve ELENDİ:
 * listede olmayan yedi sektörden gerçek sitelerde 7'de 1 doğru verdi. Modern
 * SPA'ların ham HTML'i boş, giriş yolları alt sayfalarda, ve bir sitede birden
 * çok sinyal aynı anda ateşleniyor. Kendinden emin ama yanlış cevaplar
 * üretiyordu — bu, tavsiye vermemekten kötüdür.
 */

export const SOURCE_KINDS = [
  'directory', 'marketplace', 'review', 'publication',
  'community', 'self_publish', 'authority', 'vendor', 'unknown',
] as const;

export type SourceKind = typeof SOURCE_KINDS[number];

/** Bu eşiğin altındaki sınıflandırma arayüzde 'unknown' gibi davranır. */
export const CONFIDENCE_FLOOR = 0.6;

export interface SourceClass {
  domain: string;
  kind: SourceKind;
  confidence: number;
  method: 'seed' | 'llm' | 'user' | 'manual' | 'rival' | 'self';
  entryPath?: string | null;
  note?: string | null;
}

/** Kullanıcıya gösterilecek her şey. Sınıf başına tek oyun kitabı. */
export interface Playbook {
  kind: SourceKind;
  /** Kısa etiket, tablo hücresine sığar. */
  label: string;
  /** Girilebilir mi — sıralamayı ve tonu bu belirler. */
  reachable: boolean;
  /** Neden bu kaynak önemli. */
  why: string;
  /** Sırayla yapılacaklar. */
  steps: string[];
  /** Gerçekçi süre; boş vaat vermemek için. */
  eta: string;
  /** Varsa uyarı — özellikle topluluk ve otorite sınıfında kritik. */
  warning?: string;
}

/**
 * Oyun kitapları.
 *
 * Türkçe ve dijital medya dilinde yazıldı. Her adım tek başına yapılabilir bir
 * iş; "varlık kurun" gibi ne yapılacağı belirsiz ifadeler kasten yok.
 */
export const PLAYBOOKS: Record<SourceKind, Playbook> = {
  directory: {
    kind: 'directory',
    label: 'Dizin',
    reachable: true,
    why: 'Modeller "en iyi X firmaları" sorularında bu listeleri okur. Listede olmamak, o sorunun cevabında hiç olmamaktır.',
    steps: [
      'Profili oluşturun; hizmet, sektör, konum ve fiyat aralığı alanlarını boş bırakmayın — eksik profil filtrelerde elenir',
      'Tamamlanmış 3–5 işi örnek olay olarak ekleyin, sonuçları sayıyla verin',
      'Müşterilerinizden platform üzerinden değerlendirme isteyin; çoğu dizin sıralamayı yorum sayısına bağlar',
      'Kategori seçimini dar tutun — "dijital ajans" yerine "performans pazarlama ajansı"',
    ],
    eta: 'Kayıt aynı gün · sıralamada görünürlük 2–6 hafta',
  },

  marketplace: {
    kind: 'marketplace',
    label: 'Pazar yeri',
    reachable: true,
    why: 'Ürün ve hizmet sorularında model çoğu zaman pazar yeri sayfasını kaynak gösterir; ad, fiyat ve özellik bilgisini oradan alır.',
    steps: [
      'Satıcı kaydını tamamlayın; başlıkları müşterinin aradığı biçimde yazın, kendi iç kod adınızla değil',
      'Açıklamaya özellik tablosu ve sayısal veri koyun — modeller tabloyu düz metne tercih eder',
      'Görsel, varyant ve stok bilgisini eksiksiz doldurun; eksik alan listelemeyi geri plana atar',
      'Fiyat karşılaştırma sitelerinde görünmek için ürün feed’inizi verin',
    ],
    eta: 'Satıcı onayı 1–3 hafta · performans 4–8 hafta',
  },

  review: {
    kind: 'review',
    label: 'Yorum platformu',
    reachable: true,
    why: '"Güvenilir mi", "yorumları nasıl" sorularının doğrudan kaynağı. Buradaki ton, cevabın tonunu belirler.',
    steps: [
      'Var olan profili sahiplenin — açılmasını beklemeyin, büyük ihtimalle zaten var',
      'Olumsuz yorumlara kurumsal ve çözüm odaklı yanıt verin; modeller yanıtsız şikâyeti çözülmemiş sayar',
      'Memnun müşterilerden düzenli yorum akışı kurun — tek seferlik kampanya değil, süregelen alışkanlık',
      'Yanıt oranınızı %90 üzerinde tutun',
    ],
    eta: 'Süregelen · ton değişimi 4–12 haftada cevaplara yansır',
  },

  publication: {
    kind: 'publication',
    label: 'Sektörel yayın',
    reachable: true,
    why: 'Modeller editöryel içeriği yüksek güvenilirlikte sayar. Bir sektör yazısında geçmek, kendi sitenizdeki on sayfadan değerlidir.',
    steps: [
      'Yayının konuk yazı politikasını ve editöryel takvimini inceleyin',
      'Ürün tanıtımı değil, sektör verisi öneren bir konu gönderin — kendi verinizi paylaşın, satış yapmayın',
      'Basın bültenlerinizi editör listesine ekleyin',
      'Uzman görüşü arayan gazetecilere ulaşılabilir olun',
    ],
    eta: 'İlk yayın 3–8 hafta · düzenli ilişki 3–6 ay',
  },

  community: {
    kind: 'community',
    label: 'Topluluk',
    reachable: true,
    why: 'Modeller "gerçek kullanıcı ne diyor" sorusunda buraya bakar. Aynı zamanda en riskli sınıf.',
    steps: [
      'Marka hesabıyla değil, kimliğini açıkça belirten bir çalışan hesabıyla katılın',
      'Önce yalnızca soru cevaplayın — markanızı hiç anmadan, en az birkaç hafta',
      'Marka ancak doğrudan sorulduğunda ve bağlantı vermeden geçsin',
      'Olumsuz bir başlık varsa savunmaya geçmeyin; sorunu kabul edip çözümü yazın',
    ],
    eta: '2–6 ay · kısayolu yok',
    warning: 'Acele etmek geri teper: tanıtım kokan katkı silinir, hesap banlanır ve olay başlı başına olumsuz içerik üretir.',
  },

  self_publish: {
    kind: 'self_publish',
    label: 'Kendi kanalınız',
    reachable: true,
    why: 'En hızlı kazanç. Kapı yok — bugün başlayıp bugün yayınlayabilirsiniz.',
    steps: [
      'Görünmediğiniz sorguların tam metnini başlık yapın',
      'İlk paragrafta 40–60 kelimelik doğrudan cevap verin — modeller cevabı oradan alır',
      'Kendi sitenizdeki asıl kaynağa bağlantı verin',
      'Profil bilgisini marka adı, alan adı ve açıklamayla eksiksiz doldurun',
    ],
    eta: 'Yayın aynı gün · taranma 1–4 hafta',
  },

  authority: {
    kind: 'authority',
    label: 'Kayıt / otorite',
    reachable: true,
    why: 'Modeller bu kaynakları kimlik doğrulaması için kullanır. Wikidata kaydı markayı tanınır bir varlık yapar.',
    steps: [
      'Mevcut kaydınızı bulun ve doğruluğunu kontrol edin — yanlış kayıt yokluktan kötüdür',
      'Wikidata için marka adı, alan adı, kuruluş yılı ve sektör alanlarını tamamlayın',
      'Wikipedia için kayda değerlik şartını okuyun; bağımsız kaynaklarda yeterince yer almadan denemeyin',
      'Oda ve sicil kayıtlarındaki unvan ve adresi web sitenizle birebir eşitleyin',
    ],
    eta: 'Wikidata 1–2 hafta · Wikipedia 6 ay+ veya hiç',
    warning: 'Wikipedia’ya kendi maddenizi yazmak kural ihlalidir ve geri alınır.',
  },

  vendor: {
    kind: 'vendor',
    label: 'Satıcı içeriği',
    reachable: false,
    why: 'Bu alan adının sahibi bir şey satıyor; içerik onun kendi pazarlaması. Listesine dışarıdan girilmez — rakip siteleri de bu sınıftadır.',
    steps: [
      'O sayfanın neden alıntılandığını inceleyin: hangi soruya, hangi yapıda cevap veriyor',
      'Aynı soruya kendi sitenizde daha iyi cevap veren bir kaynak yayınlayın — daha güncel veri, daha net tablo',
      'Bu içeriğin girebileceğiniz kaynaklarda (dizin, yayın) alıntılanmasını sağlayın',
      'Rakip içerikse hangi iddiayla öne çıktığını not edin, kendi konumlandırmanızda karşılığını verin',
    ],
    eta: 'Dolaylı yol · 2–4 ay',
    warning: 'Bu kaynağa doğrudan giremezsiniz. Editörüne yazmak veya hesap açmak diye bir yol yoktur.',
  },

  unknown: {
    kind: 'unknown',
    label: 'Belirlenemedi',
    reachable: false,
    why: 'Bu kaynağın türünü belirleyemedik. Yanlış tavsiye vermektense söylemiyoruz.',
    steps: [
      'Kaynağı açın ve bakın: firma ekleme veya başvuru yolu var mı?',
      'Yoksa bu bir şirketin kendi içeriği olabilir — o durumda giremezsiniz',
      'Türünü işaretleyin; işaretiniz diğer müşterilere de yardımcı olur',
    ],
    eta: '—',
  },
};

/** Alan adını normalize eder: protokol, www ve yol atılır, küçük harfe iner. */
export function normalizeDomain(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .trim();
}

/** `blog.example.com` → `example.com`. Çekirdek liste eşleşmesi için. */
function registrable(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) return domain;
  // co.uk, com.tr, org.tr gibi ikinci seviye uzantılar
  const twoLevel = ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'];
  if (parts.length >= 3 && twoLevel.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

const CACHE_TTL_DAYS = 180;

/**
 * Bir alan adı kümesini sınıflandırır.
 *
 * Rakip ve kendi alan adı listesi çağıran tarafından verilir; bunlar için ne
 * önbelleğe ne modele bakılır. Rakip zaten tanımı gereği vendor'dır.
 */
export async function classifyDomains(
  domains: string[],
  opts: { rivalDomains?: string[]; ownDomain?: string; allowLlm?: boolean } = {},
): Promise<Map<string, SourceClass>> {
  const out = new Map<string, SourceClass>();
  const own = opts.ownDomain ? normalizeDomain(opts.ownDomain) : null;
  const rivals = new Set((opts.rivalDomains || []).map(normalizeDomain).filter(Boolean));

  const wanted = [...new Set(domains.map(normalizeDomain).filter(Boolean))];
  const pending: string[] = [];

  for (const d of wanted) {
    if (own && (d === own || registrable(d) === registrable(own))) {
      out.set(d, { domain: d, kind: 'self_publish', confidence: 1, method: 'self',
        note: 'Kendi siteniz' });
    } else if (rivals.has(d) || rivals.has(registrable(d))) {
      // Müşteri bunu rakip olarak tanımladı. Rakibin sitesine girilmez.
      out.set(d, { domain: d, kind: 'vendor', confidence: 1, method: 'rival',
        note: 'Rakip listenizde' });
    } else {
      pending.push(d);
    }
  }
  if (!pending.length) return out;

  // Ortak önbellek + çekirdek liste tek sorguda. Alt alan adı için kayıtlı
  // ana alan adı da kabul edilir: blog.semrush.com da satıcı içeriğidir.
  const lookups = [...new Set(pending.flatMap(d => [d, registrable(d)]))];

  /* Tablo yoksa panelin tamamı çökmemeli.
   *
   * db/007_source_domains.sql çalıştırılmadan bu dosya yayına alınırsa Postgres
   * 42P01 (relation does not exist) fırlatıyordu; hata /api/results'ı 500'e
   * düşürüp kontrol panelini "Verileriniz yüklenemedi" ekranına çeviriyordu.
   * Yani bir migration'ın unutulması, ölçümle hiç ilgisi olmayan her sayfayı
   * kapatıyordu.
   *
   * Sınıflandırma yardımcı bir zenginleştirmedir; yokluğunda ürün çalışmaya
   * devam etmeli. Tablo eksikse her kaynak 'unknown' döner — arayüz bunu zaten
   * ele alıyor ve kullanıcı "Otomatik çöz" ile ilerleyebilir. */
  type Kayit = {
    domain: string; kind: string; confidence: string; method: string;
    entry_path: string | null; evidence: { note?: string } | null; classified_at: Date;
  };
  let rows: Kayit[] = [];
  try {
    rows = await sql<Kayit[]>`
      select domain, kind, confidence, method, entry_path, evidence, classified_at
        from source_domains where domain = any(${lookups})`;
  } catch (e) {
    const kod = (e as { code?: string }).code;
    if (kod !== '42P01') throw e;   // başka bir veritabanı hatasıysa sustur ma
    console.warn('[source-kind] source_domains tablosu yok — db/007_source_domains.sql çalıştırılmamış. '
      + 'Kaynak sınıflandırması devre dışı; panel çalışmaya devam ediyor.');
    for (const d of pending) out.set(d, { domain: d, kind: 'unknown', confidence: 0, method: 'llm' });
    return out;
  }

  const cache = new Map(rows.map(r => [r.domain, r]));
  const stillPending: string[] = [];

  for (const d of pending) {
    const hit = cache.get(d) || cache.get(registrable(d));
    const fresh = hit && (
      hit.method !== 'llm' ||
      Date.now() - new Date(hit.classified_at).getTime() < CACHE_TTL_DAYS * 864e5
    );
    if (hit && fresh) {
      out.set(d, {
        domain: d,
        kind: hit.kind as SourceKind,
        confidence: Number(hit.confidence),
        method: hit.method as SourceClass['method'],
        entryPath: hit.entry_path,
        note: hit.evidence?.note ?? null,
      });
    } else {
      stillPending.push(d);
    }
  }

  // Bilinmeyenler. Model kapalıysa veya yoksa dürüstçe unknown döner.
  for (const d of stillPending) {
    out.set(d, { domain: d, kind: 'unknown', confidence: 0, method: 'llm' });
  }
  if (opts.allowLlm === false || !stillPending.length) return out;

  const resolved = await classifyWithModel(stillPending);
  for (const r of resolved) {
    out.set(r.domain, r);
    try {
      await sql`
      insert into source_domains (domain, kind, confidence, method, evidence, entry_path)
      values (${r.domain}, ${r.kind}, ${r.confidence}, 'llm',
              ${JSON.stringify({ note: r.note ?? null })}::jsonb, ${r.entryPath ?? null})
      on conflict (domain) do update
        set kind = excluded.kind, confidence = excluded.confidence,
            evidence = excluded.evidence, entry_path = excluded.entry_path,
            classified_at = now(), updated_at = now()
        -- Elle veya kullanıcı tarafından düzeltilmiş kayıt asla ezilmez.
        where source_domains.method = 'llm'`;
    } catch (e) {
      // Tablo yoksa sınıflandırma yine de bu istek için geçerli; sadece
      // kalıcı olmuyor. Sessizce geçmek, kullanıcıyı bir migration hatasıyla
      // karşılaştırmaktan iyidir.
      if ((e as { code?: string }).code !== '42P01') throw e;
    }
  }
  return out;
}

/** Sayfa başlığı ve meta açıklaması — modelin karar vermesi için yeterli. */
async function pageHint(domain: string): Promise<{ title: string; description: string } | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const { res } = await safeFetch(`https://${domain}/`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; YankiBot/1.0)',
                 accept: 'text/html,application/xhtml+xml' },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    // Başlık ve meta belgenin ilk kilobaytlarında; tamamını okumaya gerek yok.
    const html = (await res.text()).slice(0, 200_000);
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
      .replace(/\s+/g, ' ').trim().slice(0, 120);
    const description = (html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)?.[1] || '')
      .replace(/\s+/g, ' ').trim().slice(0, 200);
    return title || description ? { title, description } : null;
  } catch {
    // Ulaşılamayan site bir hata değil: model yalnızca alan adıyla karar verir.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM = `You classify websites by ONE question: how would a brand get itself featured there?

Return JSON only: {"results":[{"domain":"...","kind":"...","confidence":0.0,"note":"..."}]}

kind must be exactly one of:
- directory     a listing where companies create their own profile (Clutch, Capterra, sector directories, partner networks)
- marketplace   products or services are sold/transacted (Trendyol, Amazon, job boards, classifieds, price comparison)
- review        ratings and user reviews are the core (Trustpilot, G2, complaint sites)
- publication   editorial content with named authors (news sites, trade magazines, independent blogs with multiple authors)
- community     user-generated discussion, self-promotion is punished (Reddit, forums, Q&A)
- self_publish  anyone can publish without a gatekeeper (Medium, LinkedIn, YouTube, GitHub)
- authority     encyclopaedias, official registries, trade associations, standards bodies
- vendor        the domain owner SELLS something and the content is their own marketing.
                This includes any single company's own website or blog — agencies,
                consultants, SaaS products. A brand CANNOT get listed here.
- unknown       you are not reasonably sure

Decisive test for vendor: is this one company talking about itself and its own
services? Then it is vendor, no matter how useful the content is.

confidence: 0.9+ only when you clearly recognise the site. Use 0.4 or lower and
kind "unknown" when guessing — a wrong confident answer is worse than "unknown".
note: at most 8 words, Turkish, explaining what the site is.`;

async function classifyWithModel(domains: string[]): Promise<SourceClass[]> {
  // En fazla 20'lik partiler: tek uzun istem, hem doğruluğu hem bütçeyi bozar.
  const batches: string[][] = [];
  for (let i = 0; i < domains.length; i += 20) batches.push(domains.slice(i, i + 20));

  const out: SourceClass[] = [];
  for (const batch of batches) {
    const hints = await Promise.all(batch.map(async d => ({ d, h: await pageHint(d) })));
    const lines = hints.map(({ d, h }) =>
      h ? `${d} — title: "${h.title}" — description: "${h.description}"` : `${d} — (page unreachable)`);

    const res = await llmJson<{
      results: { domain: string; kind: string; confidence: number; note?: string }[];
    }>({
      system: SYSTEM,
      user: `Classify these domains:\n${lines.join('\n')}`,
      maxTokens: 1200,
      temperature: 0,
    });

    const byDomain = new Map((res?.results || []).map(r => [normalizeDomain(r.domain), r]));
    for (const d of batch) {
      const r = byDomain.get(d);
      const kind = (r && (SOURCE_KINDS as readonly string[]).includes(r.kind))
        ? r.kind as SourceKind : 'unknown';
      const confidence = r ? Math.max(0, Math.min(1, Number(r.confidence) || 0)) : 0;
      // Kendi eşiğinin altında kalan cevabı sınıf olarak kabul etmiyoruz.
      const accepted = confidence >= CONFIDENCE_FLOOR ? kind : 'unknown';
      out.push({
        domain: d,
        kind: accepted,
        confidence: accepted === 'unknown' ? Math.min(confidence, CONFIDENCE_FLOOR - 0.01) : confidence,
        method: 'llm',
        note: r?.note?.slice(0, 80) ?? null,
      });
    }
  }
  return out;
}

/**
 * Aksiyon sırası: en çok atıf alan değil, en çabuk kazanılabilir olan.
 *
 * Bir dizin kaydı bugün açılır ve 24 atıf getirir; satıcı blogu 56 atıf alır
 * ama üzerinde yapılacak hiçbir şey yoktur. Sıralama bunu yansıtmalı.
 */
const REACH_RANK: Record<SourceKind, number> = {
  directory: 0, self_publish: 1, review: 2, marketplace: 3,
  publication: 4, authority: 5, community: 6, unknown: 7, vendor: 8,
};

export function sortByActionability<T extends { kind: SourceKind; citations: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) =>
    REACH_RANK[a.kind] - REACH_RANK[b.kind] || b.citations - a.citations);
}

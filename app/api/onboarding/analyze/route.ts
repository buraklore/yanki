import { z } from 'zod';
import { requireSession, handler, HttpError } from '@/lib/auth';
import { enforce } from '@/lib/rate-limit';
import { safeFetch, BlockedTargetError } from '@/lib/safe-fetch';
import { llmJson } from '@/lib/llm';
import { enabledEngines, engineByKey } from '@/lib/engines';
import { SECTORS, COUNTRIES } from '@/lib/sectors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * onboarding/analyze — alan adından marka profili, sorgular ve GERÇEK rakipler.
 *
 * Kurulum eskiden yedi alanı elle doldurtuyordu: marka adı, site, sektör, ülke,
 * şehir, açıklama, rakipler. Kullanıcının zaten bildiği şeyleri yazdırmak,
 * ilk ölçümden önce vazgeçme sebebidir. Artık tek girdi var: alan adı + ülke.
 *
 * İki farklı iş yapılıyor ve ikisinin de doğruluk gerekçesi ayrı:
 *
 * 1. MARKA BİLGİLERİ — sitenin kendi sayfasından çıkarılır. Modele "bu marka
 *    ne iş yapar" diye sormuyoruz; sayfanın metnini verip özetletiyoruz. Fark
 *    önemli: birincisi eğitim verisinden hatırlamaya çalışır ve uydurur,
 *    ikincisi önündeki metni okur.
 *
 * 2. RAKİPLER — bir yapay zeka motoruna gerçek bir kategori sorusu sorulur ve
 *    cevapta geçen marka adları çıkarılır. Modele "X'in rakipleri kim" diye
 *    sormuyoruz; o soru hatırlamaya dayanır, kapanmış şirketleri ve yanlış
 *    sektörden isimleri getirir. Bunun yerine ürünün ölçtüğü şeyin aynısını
 *    yapıyoruz: "bu kategoride yapay zeka kimi öneriyor". Böyle bulunan rakip,
 *    tanımı gereği doğru rakiptir — çünkü müşterinin karşılaştırıldığı liste
 *    tam olarak o listedir.
 */

const Body = z.object({
  domain: z.string().min(3).max(253),
  countryCode: z.string().length(2).default('TR'),
  language: z.enum(['tr', 'en']).default('tr'),
});

export interface AnalyzeResult {
  brandName: string;
  siteTitle: string;
  domain: string;
  sector: string;
  sectorTerm: string;
  description: string;
  language: string;
  country: string;
  countryCode: string;
  prompts: { text: string; intent: string; volume: number }[];
  competitors: { name: string; source: 'ai_answer' | 'model' }[];
  /** Rakiplerin hangi soruyla bulunduğu — kullanıcı gerekçeyi görsün. */
  discoveryQuery?: string;
  warnings: string[];
}

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Body.parse(await req.json());
  await enforce('siteAnalyze', s.orgId);

  const domain = b.domain.toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  if (!domain.includes('.')) throw new HttpError(400, 'Geçerli bir alan adı girin.');

  const country = COUNTRIES.find(c => c.code === b.countryCode);
  const countryName = b.language === 'tr' ? (country?.nameTr ?? 'Türkiye') : (country?.name ?? 'Turkey');
  const warnings: string[] = [];

  // ---- 1. Sitenin kendi metni ------------------------------------------
  const page = await readSite(domain);
  if (!page) {
    warnings.push('Siteye ulaşılamadı — bilgileri elle doldurmanız gerekebilir.');
  }

  // ---- 2. Marka bilgileri: sayfadan çıkarılır, hatırlanmaz --------------
  const facts = await llmJson<{
    brandName: string; siteTitle: string; sector: string; sectorTerm: string;
    description: string; language: string;
  }>({
    system: `You read a company's own homepage and fill in a factual profile. Reply JSON only.

{"brandName":"","siteTitle":"","sector":"","sectorTerm":"","description":"","language":"tr|en"}

Rules:
- brandName: the brand as customers write it. Strip legal suffixes (Ltd., A.Ş., Inc.)
  and taglines. If the page says "ByNoGame - Oyun ve E-pin", brandName is "ByNoGame".
- siteTitle: the site's own one-line positioning, in ${b.language === 'tr' ? 'Turkish' : 'English'}.
- sector: pick the closest from this list, verbatim:
${SECTORS.map(x => `  ${x.label}`).join('\n')}
- sectorTerm: 2–4 words a customer would use for this category when asking an AI
  (e.g. "dijital oyun ve e-pin", "bulut CRM", "kadın giyim"). Lowercase, no brand name.
- description: 1–2 sentences on what they sell and to whom, in ${b.language === 'tr' ? 'Turkish' : 'English'}.
- language: the language the site is written in.

Base every field on the text given. If the page is empty or unreadable, infer only
from the domain name and keep description short. Never invent products, founding
years, awards or numbers.`,
    user: page
      ? `Domain: ${domain}\nCountry: ${countryName}\n\nTitle: ${page.title}\nMeta: ${page.description}\nH1: ${page.h1}\n\nPage text:\n${page.text}`
      : `Domain: ${domain}\nCountry: ${countryName}\n(The page could not be fetched; infer from the domain name alone and keep it minimal.)`,
    maxTokens: 700,
    temperature: 0.1,
  });

  const brandName = clean(facts?.brandName) || guessBrandFromDomain(domain);
  const sector = SECTORS.find(x => x.label === facts?.sector)?.label
    ?? SECTORS[0].label;
  const sectorTerm = clean(facts?.sectorTerm) || sector.toLowerCase();
  if (!facts) warnings.push('Marka bilgileri otomatik çıkarılamadı — lütfen kontrol edin.');

  // ---- 3. Rakipler: gerçek bir AI cevabından -----------------------------
  const discovery = b.language === 'tr'
    ? `${countryName}'de en iyi ${sectorTerm} firmaları hangileri?`
    : `Which are the best ${sectorTerm} companies in ${countryName}?`;

  let competitors: AnalyzeResult['competitors'] = [];
  const engine = pickDiscoveryEngine();

  if (engine) {
    try {
      // AskOptions.country ISO-3166 kodu bekler, ülke adı değil.
      const answer = await engine.ask({
        prompt: discovery,
        language: b.language,
        country: b.countryCode,
      });
      const names = await namesFromAnswer(answer.text, brandName, sectorTerm, b.language);
      competitors = names.map(n => ({ name: n, source: 'ai_answer' as const }));
    } catch {
      warnings.push('Rakip keşfi için yapay zeka sorgusu başarısız oldu.');
    }
  } else {
    warnings.push('Hiçbir yapay zeka sağlayıcısı yapılandırılmadığı için rakipler ölçümle bulunamadı.');
  }

  /* Ölçümle bulunamadıysa modele sormak son çaredir ve işaretlenir: kullanıcı
   * "bu rakip nereden geldi" sorusunun cevabını görmeli. Ölçümle bulunan rakip
   * kanıttır, modelin hatırladığı rakip tahmindir. */
  if (competitors.length < 2) {
    const guessed = await llmJson<{ competitors: string[] }>({
      system: `List real, currently operating competitor brands. JSON only: {"competitors":[]}
Rules: 3–5 names, same country and same category, exclude the brand itself,
exclude marketplaces and directories unless they are direct competitors,
use the names customers write. If unsure, return fewer names rather than guesses.`,
      user: `Brand: ${brandName} (${domain})\nCategory: ${sectorTerm}\nCountry: ${countryName}`,
      maxTokens: 300,
      temperature: 0.2,
    });
    const extra = (guessed?.competitors ?? [])
      .map(clean)
      .filter(n => n && !sameBrand(n, brandName, domain))
      .filter(n => !competitors.some(c => sameBrand(c.name, n, '')));
    competitors = [...competitors, ...extra.map(n => ({ name: n, source: 'model' as const }))];
    if (extra.length) {
      warnings.push('Bazı rakipler ölçümle değil model bilgisiyle önerildi — doğrulayın.');
    }
  }
  competitors = competitors.slice(0, 6);

  // ---- 4. Sorgu önerileri ------------------------------------------------
  const promptRes = await llmJson<{
    prompts: { text: string; intent: string; volume?: number }[];
  }>({
    system: `You write the questions real customers type into AI assistants before buying.
JSON only: {"prompts":[{"text":"","intent":"","volume":0}]}

- 10 prompts, in ${b.language === 'tr' ? 'Turkish' : 'English'}, lowercase, no quotes.
- intent: one of transactional | comparison | evaluation | informational | brand_defence
- Include: 2 that name the brand (one trust question: "<brand> güvenilir mi"),
  2 comparisons against the competitors given, the rest category questions with
  no brand name at all.
- volume: rough monthly search estimate, integer.
- Write what a buyer asks, not what a marketer wants to rank for.`,
    user: `Brand: ${brandName}\nCategory: ${sectorTerm}\nCountry: ${countryName}\n` +
          `Competitors: ${competitors.map(c => c.name).join(', ') || '(none found)'}\n` +
          `About: ${clean(facts?.description) || '-'}`,
    maxTokens: 1100,
    temperature: 0.4,
  });

  const VALID = ['transactional', 'comparison', 'evaluation', 'informational', 'brand_defence'];
  const prompts = (promptRes?.prompts ?? [])
    .map(p => ({
      text: clean(p.text).toLowerCase().slice(0, 200),
      intent: VALID.includes(p.intent) ? p.intent : 'evaluation',
      volume: Math.max(0, Math.min(1_000_000, Number(p.volume) || 0)),
    }))
    .filter(p => p.text.length > 5)
    .slice(0, 12);
  if (!prompts.length) warnings.push('Sorgu önerileri üretilemedi — elle ekleyebilirsiniz.');

  return Response.json({
    brandName,
    siteTitle: clean(facts?.siteTitle) || page?.title?.slice(0, 120) || brandName,
    domain: `https://${domain}`,
    sector,
    sectorTerm,
    description: clean(facts?.description),
    language: facts?.language === 'en' ? 'en' : b.language,
    country: countryName,
    countryCode: b.countryCode,
    prompts,
    competitors,
    discoveryQuery: engine ? discovery : undefined,
    warnings,
  } satisfies AnalyzeResult);
});

/* ------------------------------------------------------------------ */

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Ana sayfanın okunabilir metni. Model bunu okur, hatırlamaya çalışmaz. */
async function readSite(domain: string) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const { res } = await safeFetch(`https://${domain}/`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; YankiBot/1.0; +https://yanki.app/bot)',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 500_000);

    const pick = (re: RegExp) => (html.match(re)?.[1] ?? '').replace(/<[^>]+>/g, ' ');
    const title = clean(pick(/<title[^>]*>([\s\S]*?)<\/title>/i)).slice(0, 160);
    const description = clean(pick(
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)).slice(0, 300);
    const h1 = clean(pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i)).slice(0, 200);

    // Görünür metin: script, stil ve etiketler atılır.
    const text = clean(
      html
        .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' '),
    ).slice(0, 4000);

    return { title, description, h1, text };
  } catch (e) {
    if (e instanceof BlockedTargetError) return null;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keşif için tek motor: en ucuz ve en hızlı olan yeter. Kurulum adımı sekiz
 * motoru beklemez; buradaki amaç ölçüm değil, kategori listesini görmek.
 */
function pickDiscoveryEngine() {
  const order = ['gemini', 'openai', 'perplexity', 'anthropic'];
  for (const k of order) {
    const e = engineByKey(k);
    if (e?.enabled()) return e;
  }
  return enabledEngines()[0] ?? null;
}

/**
 * Cevap metninden marka adlarını çıkarır.
 *
 * Modelden "bu metinde hangi markalar var" isteniyor — hatırlaması değil,
 * okuması gerekiyor. Kendi markamız ve kategori sözcükleri dışlanır; pazar yeri
 * ve dizinler de dışlanır çünkü onlar rakip değil, kanaldır.
 */
async function namesFromAnswer(
  answer: string, ownBrand: string, sectorTerm: string, language: string,
): Promise<string[]> {
  if (!answer || answer.length < 40) return [];
  const res = await llmJson<{ brands: string[] }>({
    system: `Extract brand names that appear in the given AI answer. JSON only: {"brands":[]}

- Only names actually written in the text. Do not add brands from your own knowledge.
- Companies competing in the stated category. Exclude:
  the brand being analysed, generic category words, marketplaces and directories
  that merely list others (Amazon, Trendyol, Clutch and similar), platform names
  (Steam, Google Play), and payment or shipping providers.
- Use the name as written in the text, without legal suffixes.
- At most 6, ordered as they appear.`,
    user: `Category: ${sectorTerm}\nBrand being analysed: ${ownBrand}\nLanguage: ${language}\n\nAnswer:\n${answer.slice(0, 6000)}`,
    maxTokens: 300,
    temperature: 0,
  });
  const seen = new Set<string>();
  return (res?.brands ?? [])
    .map(clean)
    .filter(n => n.length > 1 && n.length < 60)
    .filter(n => !sameBrand(n, ownBrand, ''))
    .filter(n => n.toLowerCase() !== sectorTerm.toLowerCase())
    .filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 6);
}

/** "ByNoGame" ile "bynogame.com" ve "Bynogame" aynı markadır. */
function sameBrand(a: string, b: string, domain: string) {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9ğüşıöç]/g, '');
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (domain) {
    const nd = norm(domain.split('.')[0]);
    if (nd && na === nd) return true;
  }
  return false;
}

/** Son çare: `bynogame.com` → `Bynogame`. */
function guessBrandFromDomain(domain: string) {
  const head = domain.split('.')[0].replace(/[-_]+/g, ' ').trim();
  return head.charAt(0).toUpperCase() + head.slice(1);
}

/**
 * prompts.ts — building the prompt set, and estimating how much each prompt
 * is actually asked.
 *
 * Two things go wrong when this is done badly:
 *
 *   1. Everyone tracks "best X" prompts, so the score measures one narrow
 *      slice of demand and moves for reasons nobody can explain. We enforce
 *      a funnel mix instead.
 *   2. Volume is treated as unknown and every prompt gets equal weight, which
 *      lets a prompt nobody asks drag the headline number around.
 *
 * Volume here is an *index*, not a search-volume promise. We say so in the UI.
 */

export type Intent = 'transactional' | 'brand_defence' | 'comparison' | 'evaluation' | 'informational';

export interface GeneratedPrompt {
  text: string;
  intent: Intent;
  volume: number;
  source: 'ai';
}

export interface PromptContext {
  brandName: string;
  sector: string;      // human label, e.g. "E-commerce & Retail"
  sectorTerm: string;  // natural phrase used inside a question, e.g. "e-commerce"
  country: string;     // "Turkey"
  city?: string | null;
  language: 'tr' | 'en';
}

/**
 * A healthy set is roughly 20% informational, 40% evaluation, 20% comparison,
 * 15% transactional, 5% brand defence. Informational prompts rarely convert
 * but they are how a model learns the brand belongs to the category at all,
 * which is why we refuse to let a customer drop them entirely.
 */
export const TARGET_MIX: Record<Intent, number> = {
  informational: 0.20,
  evaluation: 0.40,
  comparison: 0.20,
  transactional: 0.15,
  brand_defence: 0.05,
};

type Template = { intent: Intent; tr: (c: PromptContext) => string; en: (c: PromptContext) => string; base: number };

const TEMPLATES: Template[] = [
  { intent: 'informational', base: 2600,
    tr: c => `${c.sectorTerm} nedir, ne işe yarar?`,
    en: c => `What is ${c.sectorTerm} and how does it work?` },
  { intent: 'informational', base: 1400,
    tr: c => `${c.sectorTerm} seçerken nelere dikkat edilmeli?`,
    en: c => `What should you look for when choosing ${c.sectorTerm}?` },
  { intent: 'evaluation', base: 2100,
    tr: c => `${c.country}'deki en iyi ${c.sectorTerm} firmaları hangileri?`,
    en: c => `Which are the best ${c.sectorTerm} companies in ${c.country}?` },
  { intent: 'evaluation', base: 1800,
    tr: c => `${new Date().getFullYear()} yılında ${c.sectorTerm} alanındaki en iyi şirketler hangileri?`,
    en: c => `Which are the best ${c.sectorTerm} companies in ${new Date().getFullYear()}?` },
  { intent: 'evaluation', base: 1200,
    tr: c => `Küçük işletmeler için en iyi ${c.sectorTerm} çözümleri hangileridir?`,
    en: c => `What are the best ${c.sectorTerm} solutions for small businesses?` },
  { intent: 'evaluation', base: 900,
    tr: c => `Müşteri hizmetleri açısından en iyi ${c.sectorTerm} şirketleri hangileri?`,
    en: c => `Which ${c.sectorTerm} companies have the best customer service?` },
  { intent: 'evaluation', base: 700,
    tr: c => `Güvenilir ${c.sectorTerm} hizmeti sunan markalar hangileridir?`,
    en: c => `Which brands offer trustworthy ${c.sectorTerm} services?` },
  { intent: 'comparison', base: 1100,
    tr: c => `En iyi üç ${c.sectorTerm} sağlayıcısını karşılaştırır mısınız?`,
    en: c => `Can you compare the top three ${c.sectorTerm} providers?` },
  { intent: 'comparison', base: 800,
    tr: c => `${c.sectorTerm} alanındaki en popüler alternatif sağlayıcılar nelerdir?`,
    en: c => `What are the most popular alternative ${c.sectorTerm} providers?` },
  { intent: 'transactional', base: 1600,
    tr: c => `${c.sectorTerm} hizmeti nereden alınır, fiyatları nedir?`,
    en: c => `Where can I buy ${c.sectorTerm} services and what do they cost?` },
  { intent: 'transactional', base: 1000,
    tr: c => `Uygun fiyatlı ${c.sectorTerm} önerir misin?`,
    en: c => `Can you recommend affordable ${c.sectorTerm}?` },
  { intent: 'brand_defence', base: 260,
    tr: c => `${c.brandName} güvenilir mi, yorumlar nasıl?`,
    en: c => `Is ${c.brandName} trustworthy? What do reviews say?` },
];

const CITY_TEMPLATE: Template = {
  intent: 'evaluation', base: 640,
  tr: c => `${c.city}'da faaliyet gösteren önde gelen ${c.sectorTerm} şirketleri nelerdir?`,
  en: c => `Which leading ${c.sectorTerm} companies operate in ${c.city}?`,
};

/**
 * Deterministic jitter keyed on the prompt text, so the same workspace always
 * sees the same index and the number does not appear to wobble on reload.
 * Real deployments should replace this with a provider signal (search volume,
 * People-Also-Ask frequency, forum thread counts) — see estimateVolume below.
 */
function jitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 0.7 + ((h >>> 0) % 1000) / 1000 * 0.6; // 0.7 … 1.3
}

export function generatePrompts(ctx: PromptContext): GeneratedPrompt[] {
  const set = ctx.city ? [...TEMPLATES, CITY_TEMPLATE] : TEMPLATES;
  return set.map(t => {
    const text = ctx.language === 'tr' ? t.tr(ctx) : t.en(ctx);
    return {
      text,
      intent: t.intent,
      volume: Math.round(t.base * jitter(text)),
      source: 'ai' as const,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Funnel balance                                                      */
/* ------------------------------------------------------------------ */

export interface MixReport {
  balanced: boolean;
  counts: Record<Intent, number>;
  /** Human-readable warnings for the onboarding UI. */
  warnings: string[];
}

export function checkMix(prompts: { intent: Intent }[]): MixReport {
  const counts = { informational: 0, evaluation: 0, comparison: 0, transactional: 0, brand_defence: 0 } as Record<Intent, number>;
  prompts.forEach(p => { counts[p.intent] = (counts[p.intent] ?? 0) + 1; });

  const total = prompts.length || 1;
  const warnings: string[] = [];

  for (const [intent, target] of Object.entries(TARGET_MIX) as [Intent, number][]) {
    const share = counts[intent] / total;
    if (share < target * 0.4) {
      warnings.push(`Only ${Math.round(share * 100)}% of your prompts are ${intent.replace('_', ' ')} — the target is about ${Math.round(target * 100)}%.`);
    }
  }
  if (!counts.brand_defence) {
    warnings.push('No brand-defence prompt. Without one you cannot see what models say when someone asks whether you are trustworthy.');
  }
  return { balanced: warnings.length === 0, counts, warnings };
}

/* ------------------------------------------------------------------ */
/* Volume estimation                                                   */
/* ------------------------------------------------------------------ */

export interface VolumeSignals {
  /** Monthly search volume for the closest keyword, if a provider is wired. */
  searchVolume?: number;
  /** Number of distinct sources the answer engines cite for this prompt. */
  sourceCount?: number;
  /** Times the phrase appears in People-Also-Ask / related questions. */
  paaHits?: number;
}

/**
 * Blends whatever signals are available into a single index. Every term is
 * optional so the product degrades gracefully: with no provider wired we fall
 * back to the template base, and the UI labels the column "estimated".
 *
 * We deliberately damp search volume with a square root before blending. A
 * keyword with 100x the searches does not deserve 100x the weight in a score
 * that is meant to describe a brand's overall standing.
 */
export function estimateVolume(base: number, s: VolumeSignals = {}): number {
  let v = base;
  if (s.searchVolume && s.searchVolume > 0) {
    v = Math.sqrt(s.searchVolume) * 12; // maps 10k searches → ~1200 index
  }
  if (s.paaHits) v *= 1 + Math.min(s.paaHits, 10) / 20;      // up to +50%
  if (s.sourceCount) v *= 1 + Math.min(s.sourceCount, 12) / 40; // up to +30%
  return Math.max(50, Math.round(v));
}

/**
 * Opportunity score, used by the Opportunities screen.
 *
 *   coverage    how much of the prompt-set you already own (lower = more room)
 *   volume      how much demand exists
 *   sourceCount how crowded the answer already is (fewer = easier to enter)
 *   fit         how close your existing content is
 *
 * Kept as a pure function so the same numbers can be produced in a report,
 * an export and the UI without drifting apart.
 */
export function opportunityScore(o: {
  coverage: number;      // 0…1
  volume: number;
  sourceCount: number;
  fit: 'high' | 'medium' | 'low';
  intent: Intent;
}): number {
  const fitWeight = { high: 1, medium: 0.7, low: 0.4 }[o.fit];
  const intentWeight = { transactional: 1, brand_defence: 0.95, comparison: 0.9, evaluation: 0.85, informational: 0.7 }[o.intent];
  const demand = Math.min(1, Math.sqrt(o.volume) / 70);
  const crowding = 1 - Math.min(1, o.sourceCount / 12);

  const raw = (1 - o.coverage) * 0.45 + demand * 0.30 + crowding * 0.15 + fitWeight * 0.10;
  return Math.round(Math.max(0, Math.min(100, raw * 100 * intentWeight)));
}

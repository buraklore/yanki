import { z } from 'zod';
import { llmText, llmAvailable } from './llm';
import type { Intent, GeneratedPrompt, PromptContext } from './prompts';
import { TARGET_MIX } from './prompts';

/**
 * prompt-ai.ts — generating the prompt set with a model instead of templates.
 *
 * Templates produce grammatical sentences that nobody types. Interpolating a
 * sector label gives you "oyun ve e-pin nedir, ne işe yarar?" — correct
 * Turkish, zero search demand, and useless as a visibility measurement. What
 * we need is what an actual customer types before they buy: "en güvenilir epin
 * sitesi hangisi", "steam cüzdan kodu ucuz nereden alınır".
 *
 * So we ask a model, and then we check its work. The model is good at knowing
 * how people phrase things; it is not trusted to decide what counts as a valid
 * prompt set. Every response is schema-validated, filtered and balanced here.
 * If anything fails we fall back to templates rather than shipping garbage.
 */

const SYSTEM = `You write the search prompts a real customer types into ChatGPT, Gemini or Perplexity when they are about to buy something in a given category.

You will be given a brand, its category, its country and a short description.

Rules:
- Write prompts a CUSTOMER would type, not prompts a consultant would write.
  Good: "en ucuz steam cüzdan kodu nereden alınır"
  Bad:  "oyun ve e-pin nedir, ne işe yarar?"
- Use the everyday words of that market, including slang and product names
  people actually search for. Prefer concrete products and use cases over
  abstract category labels.
- Write in the language of the target country.
- NEVER mention the brand except in prompts with intent "brand_defence".
  The whole point is to see whether the model brings the brand up unprompted.
- Vary length and phrasing: some are short keyword-style, some are full
  questions, some ask for a comparison or a recommendation.
- No duplicates and no near-duplicates.

Return ONLY minified JSON, no prose and no markdown fences:
{"prompts":[{"text":"...","intent":"transactional|brand_defence|comparison|evaluation|informational","reason":"<=8 words on why a buyer types this"}]}

Intent meanings:
  transactional  ready to buy: price, where to buy, discounts
  comparison     weighing named options against each other
  evaluation     looking for the best or most trustworthy provider
  informational  learning about the category before choosing
  brand_defence  asking specifically whether THIS brand is trustworthy`;

const Response = z.object({
  prompts: z.array(z.object({
    text: z.string().min(6).max(200),
    intent: z.enum(['transactional', 'brand_defence', 'comparison', 'evaluation', 'informational']),
    reason: z.string().max(120).optional(),
  })).min(4).max(60),
});

export interface AiPrompt extends GeneratedPrompt {
  reason?: string;
}

/** Rough demand index by intent; replaced by a provider signal when wired. */
const BASE_VOLUME: Record<Intent, number> = {
  informational: 2200,
  evaluation: 1500,
  comparison: 900,
  transactional: 1300,
  brand_defence: 260,
};

function stableJitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 0.7 + ((h >>> 0) % 1000) / 1000 * 0.6;
}

const normalise = (t: string) =>
  t.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function aiPromptsAvailable(): boolean {
  return llmAvailable();
}

async function callModel(user: string): Promise<string | null> {
  // Prompt writing wants some variety, unlike the judge which must be
  // reproducible — hence a non-zero temperature here and zero there.
  return llmText({
    system: SYSTEM,
    user,
    maxTokens: 2000,
    temperature: 0.7,
    model: process.env.PROMPT_MODEL,
  });
}

export async function generatePromptsWithAI(
  ctx: PromptContext & { domain?: string },
  count = 14,
): Promise<AiPrompt[] | null> {
  if (!aiPromptsAvailable()) return null;

  const wanted = Object.entries(TARGET_MIX)
    .map(([intent, share]) => `${intent}: about ${Math.max(1, Math.round(count * share))}`)
    .join(', ');

  const user = [
    `Brand: ${ctx.brandName}`,
    ctx.domain ? `Website: ${ctx.domain}` : '',
    `Category: ${ctx.sector} (${ctx.sectorTerm})`,
    `Country: ${ctx.country}`,
    ctx.city ? `City: ${ctx.city}` : '',
    `Language: ${ctx.language === 'tr' ? 'Turkish' : 'English'}`,
    ctx.description ? `What they do: ${ctx.description}` : '',
    '',
    `Write ${count} prompts. Aim for this mix — ${wanted}.`,
  ].filter(Boolean).join('\n');

  let raw: string | null;
  try {
    raw = await callModel(user);
  } catch {
    return null;   // caller falls back to templates
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = Response.parse(JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim()));
  } catch {
    return null;
  }

  // The model is good at phrasing, not at bookkeeping. Enforce the rules here.
  const seen = new Set<string>();
  const brandKey = normalise(ctx.brandName);
  const out: AiPrompt[] = [];

  for (const p of parsed.prompts) {
    const text = p.text.trim().replace(/^["']|["']$/g, '');
    const key = normalise(text);
    if (!key || seen.has(key)) continue;

    // A prompt that names the brand is a gimme — the model is being asked
    // about the brand rather than choosing it. Only brand_defence may.
    if (p.intent !== 'brand_defence' && brandKey && key.includes(brandKey)) continue;

    seen.add(key);
    out.push({
      text,
      intent: p.intent as Intent,
      volume: Math.round(BASE_VOLUME[p.intent as Intent] * stableJitter(text)),
      source: 'ai',
      reason: p.reason,
    });
  }

  return out.length >= 4 ? out : null;
}

/**
 * llm.ts — one text completion, from whichever provider happens to be
 * configured.
 *
 * Three features need a model that is not the one being measured: the mention
 * judge (extract.ts), the attribute extractor (attributes.ts) and the starter
 * prompt writer (prompt-ai.ts). Each of them grew its own provider ladder, and
 * every ladder started at Anthropic and stopped at OpenAI.
 *
 * That is a real hole rather than an oversight to tidy later. A workspace
 * holding only a Google key still gets scanned — Gemini answers the prompts —
 * but the judge never runs, so recommendation and sentiment fall to zero on
 * every row. Those two carry 0.28 of the score, which caps a flawless brand at
 * 72 out of 100 and reads as a measurement rather than a missing capability.
 * Attributes report as unavailable and the prompt set silently drops to generic
 * templates.
 *
 * So: one ladder, in one place, ending at Gemini. Adding a provider means
 * adding a branch here and nowhere else.
 */

export type LlmProvider = 'anthropic' | 'openai' | 'gemini';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Overrides the per-provider default; usually a *_MODEL env var. */
  model?: string;
  signal?: AbortSignal;
}

/** Which provider a utility call would use, or null when none is configured. */
export function llmProvider(): LlmProvider | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GOOGLE_AI_API_KEY) return 'gemini';
  return null;
}

export const llmAvailable = () => llmProvider() !== null;

/**
 * Returns the model's text, or null when no provider is configured.
 * Throws on a provider error so callers can distinguish "not set up" from
 * "set up and failing" — the two need different messages to the operator.
 */
export async function llmText(req: LlmRequest): Promise<string | null> {
  const provider = llmProvider();
  if (!provider) return null;

  const maxTokens = req.maxTokens ?? 1200;
  const temperature = req.temperature ?? 0;

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: req.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
        max_tokens: maxTokens,
        temperature,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json() as { content?: { type: string; text?: string }[] };
    return (json.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('');
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: req.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: req.model || process.env.OPENAI_MODEL || 'gpt-5.6-luna',
        instructions: req.system,
        input: req.user,
        max_output_tokens: Math.max(maxTokens, 1024),
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json() as {
      output_text?: string;
      output?: { content?: { type: string; text?: string }[] }[];
    };
    return json.output_text ??
      (json.output ?? []).flatMap(o => o.content ?? [])
        .filter(c => c.type === 'output_text').map(c => c.text).join('');
  }

  // Gemini. Deliberately no google_search tool here: these are reasoning calls
  // over text we already hold, and grounding would let fresh web content leak
  // into a verdict that is supposed to describe the stored answer only.
  const model = req.model || process.env.GEMINI_UTILITY_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      signal: req.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_AI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map(p => p.text).filter(Boolean).join('\n');
}

/**
 * Same call, parsed as JSON. Models wrap JSON in fences however firmly you ask
 * them not to, and a stray fence is not a reason to lose a whole batch.
 */
export async function llmJson<T>(req: LlmRequest): Promise<T | null> {
  const text = await llmText(req);
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?|```$/gm, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Last resort: the outermost object in the response.
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(cleaned.slice(first, last + 1)) as T; } catch { /* fall through */ }
    }
    return null;
  }
}

/**
 * engines/index.ts — one adapter per AI surface.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Official APIs only. Where a surface has no API (Google AI Overviews) we
 *    go through a licensed SERP provider that carries the compliance burden
 *    contractually. We never drive a logged-in consumer UI with a headless
 *    browser: it breaks the vendor's terms, it gets IP-banned, and it fails
 *    every enterprise security review.
 *
 * 2. Model names are configuration, not code. Providers rename and retire
 *    models constantly, so a hardcoded name is a scheduled outage. Every
 *    engine reads its model from the environment with a current default, and
 *    `test()` surfaces the provider's own error — a stale model name shows up
 *    on the Settings screen instead of as silent zeroes in the score.
 */

export type CollectionMethod = 'official_api' | 'serp_provider';

export interface AskOptions {
  prompt: string;
  language: string;   // ISO-639-1, e.g. "tr"
  country: string;    // ISO-3166-1 alpha-2, e.g. "TR"
  city?: string | null;
  signal?: AbortSignal;
}

export interface EngineAnswer {
  text: string;
  citations: { url: string; title?: string }[];
  modelVersion: string;
  method: CollectionMethod;
  latencyMs: number;
  raw: unknown;
}

export interface TestResult {
  ok: boolean;
  detail: string;
  modelVersion?: string;
  latencyMs?: number;
}

export interface Engine {
  key: string;
  label: string;
  method: CollectionMethod;
  envKey: string;
  modelEnvKey: string;
  defaultModel: string;
  enabled(): boolean;
  ask(o: AskOptions): Promise<EngineAnswer>;
  test(): Promise<TestResult>;
}

const env = (k: string, fallback = '') => process.env[k] || fallback;

/**
 * Neutral instruction. We measure what an ordinary user sees, so we must not
 * steer the model toward or away from naming brands. Changing this string
 * breaks comparability with historical scans — version it if you must.
 */
const NEUTRAL_SYSTEM =
  'You are a helpful assistant. Answer the user naturally and concisely, ' +
  'as you would for any consumer. Cite sources when you use them.';

type Json = Record<string, unknown>;

async function post(url: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return { json: JSON.parse(text) as Json, latencyMs: Date.now() - started };
}

/* ------------------------------------------------------------------ */
/* ChatGPT — OpenAI Responses API                                      */
/* ------------------------------------------------------------------ */

export const openai: Engine = {
  key: 'chatgpt',
  label: 'ChatGPT',
  method: 'official_api',
  envKey: 'OPENAI_API_KEY',
  modelEnvKey: 'OPENAI_MODEL',
  // Efficient, high-volume tier: we make thousands of calls a day, not dozens.
  defaultModel: 'gpt-5.6-luna',
  enabled: () => !!env('OPENAI_API_KEY'),

  async ask({ prompt, country, signal }) {
    const model = env('OPENAI_MODEL', openai.defaultModel);
    const { json, latencyMs } = await post(
      'https://api.openai.com/v1/responses',
      {
        model,
        instructions: NEUTRAL_SYSTEM,
        input: prompt,
        // Hosted web_search tool. web_search_preview is the legacy name and
        // does not support newer controls.
        tools: [{ type: 'web_search', user_location: { type: 'approximate', country } }],
        // Reasoning models spend output tokens before answering; too small a
        // cap returns status "incomplete" with no text while still billing.
        max_output_tokens: 8192,
      },
      { authorization: `Bearer ${env('OPENAI_API_KEY')}` },
      signal,
    );

    const output = (json.output as Json[]) ?? [];
    const content = output.flatMap(o => (o.content as Json[]) ?? []);
    const text = (json.output_text as string) ??
      content.filter(c => c.type === 'output_text').map(c => c.text as string).join('\n');
    const citations = content
      .flatMap(c => (c.annotations as Json[]) ?? [])
      .filter(a => a.type === 'url_citation')
      .map(a => ({ url: a.url as string, title: a.title as string | undefined }))
      .filter(c => c.url);

    return { text: text ?? '', citations, modelVersion: (json.model as string) ?? model,
             method: 'official_api', latencyMs, raw: json };
  },

  async test() {
    try {
      const model = env('OPENAI_MODEL', openai.defaultModel);
      const { json, latencyMs } = await post('https://api.openai.com/v1/responses',
        { model, input: 'Reply with the single word: ok', max_output_tokens: 64 },
        { authorization: `Bearer ${env('OPENAI_API_KEY')}` });
      return { ok: true, detail: 'Connected', modelVersion: (json.model as string) ?? model, latencyMs };
    } catch (e) { return { ok: false, detail: (e as Error).message.slice(0, 240) }; }
  },
};

/* ------------------------------------------------------------------ */
/* Claude — Anthropic Messages API                                     */
/* ------------------------------------------------------------------ */

export const anthropic: Engine = {
  key: 'claude',
  label: 'Claude',
  method: 'official_api',
  envKey: 'ANTHROPIC_API_KEY',
  modelEnvKey: 'ANTHROPIC_MODEL',
  defaultModel: 'claude-haiku-4-5',
  enabled: () => !!env('ANTHROPIC_API_KEY'),

  async ask({ prompt, country, city, signal }) {
    const model = env('ANTHROPIC_MODEL', anthropic.defaultModel);
    const { json, latencyMs } = await post(
      'https://api.anthropic.com/v1/messages',
      {
        model,
        max_tokens: 1500,
        system: NEUTRAL_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 4,
          user_location: city
            ? { type: 'approximate', city, country }
            : { type: 'approximate', country },
        }],
      },
      { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      signal,
    );

    const blocks = (json.content as Json[]) ?? [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text as string).join('\n');
    // Citations ride on text blocks; raw results arrive as
    // web_search_tool_result blocks. Take both, de-duplicate later.
    const fromText = blocks.flatMap(b => (b.citations as Json[]) ?? []);
    const fromResults = blocks
      .filter(b => b.type === 'web_search_tool_result')
      .flatMap(b => (b.content as Json[]) ?? []);
    const citations = [...fromText, ...fromResults]
      .map(c => ({ url: c.url as string, title: c.title as string | undefined }))
      .filter(c => c.url);

    return { text, citations, modelVersion: (json.model as string) ?? model,
             method: 'official_api', latencyMs, raw: json };
  },

  async test() {
    try {
      const model = env('ANTHROPIC_MODEL', anthropic.defaultModel);
      const { json, latencyMs } = await post('https://api.anthropic.com/v1/messages',
        { model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with: ok' }] },
        { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' });
      return { ok: true, detail: 'Connected', modelVersion: (json.model as string) ?? model, latencyMs };
    } catch (e) { return { ok: false, detail: (e as Error).message.slice(0, 240) }; }
  },
};

/* ------------------------------------------------------------------ */
/* Gemini — Google AI generateContent with Search grounding            */
/* ------------------------------------------------------------------ */

/**
 * Grounding chunks come back as vertexaisearch redirect URLs, which are
 * useless for citation analysis — every source would look like Google. The
 * real publisher sits in the chunk title, so prefer it when the URI is a
 * redirect.
 */
function geminiSource(chunk: { uri?: string; title?: string }): { url: string; title?: string } | null {
  const { uri, title } = chunk;
  if (title && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(title)) {
    return { url: `https://${title}`, title };
  }
  return uri ? { url: uri, title } : null;
}

export const gemini: Engine = {
  key: 'gemini',
  label: 'Google Gemini',
  method: 'official_api',
  envKey: 'GOOGLE_AI_API_KEY',
  modelEnvKey: 'GEMINI_MODEL',
  defaultModel: 'gemini-3.5-flash',
  enabled: () => !!env('GOOGLE_AI_API_KEY'),

  async ask({ prompt, signal }) {
    const model = env('GEMINI_MODEL', gemini.defaultModel);
    const { json, latencyMs } = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        systemInstruction: { parts: [{ text: NEUTRAL_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      },
      { 'x-goog-api-key': env('GOOGLE_AI_API_KEY') },
      signal,
    );

    const cand = ((json.candidates as Json[]) ?? [])[0];
    const parts = ((cand?.content as Json)?.parts as Json[]) ?? [];
    const text = parts.map(p => p.text as string).filter(Boolean).join('\n');
    const chunks = ((cand?.groundingMetadata as Json)?.groundingChunks as Json[]) ?? [];
    const citations = chunks
      .map(c => geminiSource((c.web as { uri?: string; title?: string }) ?? {}))
      .filter((c): c is { url: string; title?: string } => !!c);

    return { text, citations, modelVersion: model, method: 'official_api', latencyMs, raw: json };
  },

  async test() {
    try {
      const model = env('GEMINI_MODEL', gemini.defaultModel);
      const { latencyMs } = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { contents: [{ role: 'user', parts: [{ text: 'Reply with: ok' }] }] },
        { 'x-goog-api-key': env('GOOGLE_AI_API_KEY') });
      return { ok: true, detail: 'Connected', modelVersion: model, latencyMs };
    } catch (e) { return { ok: false, detail: (e as Error).message.slice(0, 240) }; }
  },
};

/* ------------------------------------------------------------------ */
/* Perplexity — Sonar                                                  */
/* ------------------------------------------------------------------ */

export const perplexity: Engine = {
  key: 'perplexity',
  label: 'Perplexity',
  method: 'official_api',
  envKey: 'PERPLEXITY_API_KEY',
  modelEnvKey: 'PERPLEXITY_MODEL',
  defaultModel: 'sonar',
  enabled: () => !!env('PERPLEXITY_API_KEY'),

  async ask({ prompt, country, signal }) {
    const model = env('PERPLEXITY_MODEL', perplexity.defaultModel);
    const { json, latencyMs } = await post(
      env('PERPLEXITY_URL', 'https://api.perplexity.ai/chat/completions'),
      {
        model,
        messages: [{ role: 'system', content: NEUTRAL_SYSTEM }, { role: 'user', content: prompt }],
        web_search_options: { user_location: { country } },
      },
      { authorization: `Bearer ${env('PERPLEXITY_API_KEY')}` },
      signal,
    );

    const choices = (json.choices as Json[]) ?? [];
    const text = ((choices[0]?.message as Json)?.content as string) ?? '';
    const raw = (json.search_results as Json[]) ?? (json.citations as unknown[]) ?? [];
    const citations = raw
      .map(c => (typeof c === 'string'
        ? { url: c, title: undefined }
        : { url: (c as Json).url as string, title: (c as Json).title as string | undefined }))
      .filter(c => c.url);

    return { text, citations, modelVersion: (json.model as string) ?? model,
             method: 'official_api', latencyMs, raw: json };
  },

  async test() {
    try {
      const model = env('PERPLEXITY_MODEL', perplexity.defaultModel);
      const { json, latencyMs } = await post(
        env('PERPLEXITY_URL', 'https://api.perplexity.ai/chat/completions'),
        { model, messages: [{ role: 'user', content: 'Reply with: ok' }], max_tokens: 16 },
        { authorization: `Bearer ${env('PERPLEXITY_API_KEY')}` });
      return { ok: true, detail: 'Connected', modelVersion: (json.model as string) ?? model, latencyMs };
    } catch (e) { return { ok: false, detail: (e as Error).message.slice(0, 240) }; }
  },
};

/* ------------------------------------------------------------------ */
/* OpenAI-compatible surfaces: Grok, DeepSeek                          */
/* ------------------------------------------------------------------ */

function openAICompatible(cfg: {
  key: string; label: string; url: string; envKey: string;
  modelEnvKey: string; defaultModel: string;
}): Engine {
  return {
    key: cfg.key,
    label: cfg.label,
    method: 'official_api',
    envKey: cfg.envKey,
    modelEnvKey: cfg.modelEnvKey,
    defaultModel: cfg.defaultModel,
    enabled: () => !!env(cfg.envKey),

    async ask({ prompt, signal }) {
      const model = env(cfg.modelEnvKey, cfg.defaultModel);
      const { json, latencyMs } = await post(
        cfg.url,
        {
          model,
          messages: [{ role: 'system', content: NEUTRAL_SYSTEM }, { role: 'user', content: prompt }],
          max_tokens: 1200,
        },
        { authorization: `Bearer ${env(cfg.envKey)}` },
        signal,
      );
      const choices = (json.choices as Json[]) ?? [];
      const text = ((choices[0]?.message as Json)?.content as string) ?? '';
      const citations = ((json.citations as string[]) ?? []).map(u => ({ url: u })).filter(c => c.url);
      return { text, citations, modelVersion: (json.model as string) ?? model,
               method: 'official_api', latencyMs, raw: json };
    },

    async test() {
      try {
        const model = env(cfg.modelEnvKey, cfg.defaultModel);
        const { json, latencyMs } = await post(cfg.url,
          { model, messages: [{ role: 'user', content: 'Reply with: ok' }], max_tokens: 16 },
          { authorization: `Bearer ${env(cfg.envKey)}` });
        return { ok: true, detail: 'Connected', modelVersion: (json.model as string) ?? model, latencyMs };
      } catch (e) { return { ok: false, detail: (e as Error).message.slice(0, 240) }; }
    },
  };
}

export const grok = openAICompatible({
  key: 'grok', label: 'Grok', url: 'https://api.x.ai/v1/chat/completions',
  envKey: 'XAI_API_KEY', modelEnvKey: 'XAI_MODEL', defaultModel: 'grok-4',
});

export const deepseek = openAICompatible({
  key: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions',
  envKey: 'DEEPSEEK_API_KEY', modelEnvKey: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat',
});

/* ------------------------------------------------------------------ */
/* Google AI Overviews — via a licensed SERP provider                  */
/* ------------------------------------------------------------------ */

async function serp(query: string, language: string, country: string, signal?: AbortSignal) {
  const started = Date.now();
  const url = new URL(env('SERP_PROVIDER_URL', 'https://serpapi.com/search'));
  url.searchParams.set('q', query);
  url.searchParams.set('hl', language);
  url.searchParams.set('gl', country.toLowerCase());
  url.searchParams.set('api_key', env('SERP_PROVIDER_KEY'));
  const res = await fetch(url, { signal });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
  return { json: JSON.parse(text) as Json, latencyMs: Date.now() - started };
}

/**
 * Google does not always ship the overview inside the search response. When it
 * defers, SerpApi returns `ai_overview.page_token` and nothing else, and the
 * content has to be fetched with a second call.
 *
 * Without this, a deferred overview parses to an empty string and is stored as
 * "Google showed no AI Overview for this query" — a confident, wrong negative
 * that would quietly drag the score down. An empty overview and an unfetched
 * one are different facts and must not collapse into the same row.
 *
 * The token expires in about a minute, so the follow-up happens immediately or
 * not at all. A failure here is swallowed on purpose: the caller still has the
 * first response, and a missing overview is better than a failed scan cell.
 */
async function serpOverviewByToken(pageToken: string, signal?: AbortSignal): Promise<Json | null> {
  try {
    const url = new URL(env('SERP_PROVIDER_URL', 'https://serpapi.com/search'));
    url.searchParams.set('engine', 'google_ai_overview');
    url.searchParams.set('page_token', pageToken);
    url.searchParams.set('api_key', env('SERP_PROVIDER_KEY'));
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json = JSON.parse(await res.text()) as Json;
    return ((json.ai_overview as Json) ?? null);
  } catch {
    return null;
  }
}

export const aiOverviews: Engine = {
  key: 'ai_overviews',
  label: 'Google AI Overviews',
  method: 'serp_provider',
  envKey: 'SERP_PROVIDER_KEY',
  modelEnvKey: 'SERP_PROVIDER_URL',
  defaultModel: 'serpapi',
  enabled: () => !!env('SERP_PROVIDER_KEY'),

  async ask({ prompt, language, country, signal }) {
    const { json, latencyMs } = await serp(prompt, language, country, signal);
    let ov = (json.ai_overview as Json) ?? {};

    // Deferred overview: the first response carries only a token.
    if (!ov.text_blocks && typeof ov.page_token === 'string') {
      ov = (await serpOverviewByToken(ov.page_token, signal)) ?? ov;
    }

    const flatten = (b: Json): string =>
      (b.snippet as string) ||
      ((b.list as Json[]) ?? []).map(flatten).join(' ') ||
      '';
    const text = ((ov.text_blocks as Json[]) ?? []).map(flatten).filter(Boolean).join('\n');

    const citations = ((ov.references as Json[]) ?? [])
      .map(r => ({ url: r.link as string, title: r.title as string | undefined }))
      .filter(c => c.url);

    // An empty overview is a real, meaningful result: Google did not show one
    // for this query. We record it rather than treating it as a failure.
    return { text, citations, modelVersion: 'ai_overviews', method: 'serp_provider', latencyMs, raw: json };
  },

  async test() {
    try {
      const { json, latencyMs } = await serp('what is generative engine optimization', 'en', 'US');
      return {
        ok: true,
        detail: json.ai_overview ? 'Connected — AI Overview returned'
                                 : 'Connected — no AI Overview for the test query',
        modelVersion: 'ai_overviews', latencyMs,
      };
    } catch (e) { return { ok: false, detail: (e as Error).message.slice(0, 240) }; }
  },
};

/* ------------------------------------------------------------------ */
/* Mock engines — development and CI only                              */
/* ------------------------------------------------------------------ */

/**
 * MOCK_ENGINES=1 exercises the whole pipeline without provider keys. It is
 * never enabled implicitly: with no keys and no flag, a scan reports
 * `no_engine_keys` rather than inventing numbers.
 */
function mockEngine(key: string, label: string): Engine {
  return {
    key, label, method: 'official_api', envKey: 'MOCK_ENGINES',
    modelEnvKey: `MOCK_MODEL_${key.toUpperCase()}`, defaultModel: `mock-${key}`,
    enabled: () => env('MOCK_ENGINES') === '1',
    async ask({ prompt }) {
      const started = Date.now();
      let h = 2166136261;
      const seed = prompt + key + Math.floor(Math.random() * 3);
      for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
      const r = ((h >>> 0) % 1000) / 1000;
      const brand = env('MOCK_BRAND', 'Acme Commerce');
      const rivals = env('MOCK_RIVALS', 'Bulut CRM,Pikselo,Norma').split(',');
      const names = r > 0.42 ? [rivals[0], brand, rivals[1]] : [rivals[0], rivals[1], rivals[2]];
      const text =
        `Bu alanda öne çıkan seçenekler arasında ${names.join(', ')} bulunuyor. ` +
        `${names[0]}, yerel entegrasyonlarıyla sıkça tercih ediliyor. ` +
        (r > 0.42 ? `${brand} ise kurulum süresinin kısalığıyla öne çıkıyor ve küçük ekipler için öneriliyor. ` : '') +
        `Seçim yaparken fiyat, destek ve entegrasyon derinliğine bakmak gerekir.`;
      await new Promise(res => setTimeout(res, 20 + Math.random() * 60));
      return {
        text,
        citations: r > 0.6
          ? [{ url: `https://${env('MOCK_DOMAIN', 'acme.test')}/hakkimizda` }, { url: 'https://eksisozluk.com/entry/1' }]
          : [{ url: 'https://webrazzi.com/haber' }],
        modelVersion: `mock-${key}`, method: 'official_api' as const,
        latencyMs: Date.now() - started, raw: { mock: true },
      };
    },
    async test() { return { ok: true, detail: 'Mock engine (no provider call)', modelVersion: `mock-${key}` }; },
  };
}

const MOCK_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT', gemini: 'Google Gemini', perplexity: 'Perplexity',
  claude: 'Claude', ai_overviews: 'Google AI Overviews', grok: 'Grok', deepseek: 'DeepSeek',
};
const MOCKS: Engine[] = Object.entries(MOCK_LABELS).map(([k, l]) => mockEngine(k, l));

export const REAL_ENGINES: Engine[] = [openai, gemini, perplexity, anthropic, aiOverviews, grok, deepseek];

export const ENGINES: Engine[] = env('MOCK_ENGINES') === '1' ? MOCKS : REAL_ENGINES;

export const enabledEngines = () => ENGINES.filter(e => e.enabled());
export const engineByKey = (key: string) => ENGINES.find(e => e.key === key);

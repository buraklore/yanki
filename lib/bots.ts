/**
 * bots.ts — AI crawler detection over server access logs.
 *
 * Crawler traffic is the leading indicator of visibility: a page that is
 * never crawled cannot enter an answer, and a bot that starts fetching
 * /llms.txt is the first measurable effect of publishing one. Everything in
 * this file is pure and pinned by tests; the ingest endpoint only feeds it.
 *
 * Privacy note that shaped the design: raw log lines are parsed and dropped.
 * Only per-day counters per bot are stored — no IPs, no visitor paths.
 */

export interface BotEvent { ua: string; path: string }

/**
 * Canonical AI crawlers, keyed by the user-agent substring that identifies
 * them. Order matters: longer, more specific tokens first, so
 * "Claude-SearchBot" is not swallowed by a hypothetical shorter match.
 * The list intentionally mirrors the robots.txt generator in app.html —
 * what we tell customers to allow is what we count.
 */
const BOT_TOKENS: [token: string, label: string][] = [
  ['oai-searchbot', 'OAI-SearchBot'],
  ['chatgpt-user', 'ChatGPT-User'],
  ['gptbot', 'GPTBot'],
  ['claude-searchbot', 'Claude-SearchBot'],
  ['claude-user', 'Claude-User'],
  ['claudebot', 'ClaudeBot'],
  ['anthropic-ai', 'anthropic-ai'],
  ['perplexity-user', 'Perplexity-User'],
  ['perplexitybot', 'PerplexityBot'],
  ['google-extended', 'Google-Extended'],
  ['googleother', 'GoogleOther'],
  ['applebot-extended', 'Applebot-Extended'],
  ['meta-externalagent', 'meta-externalagent'],
  ['meta-externalfetcher', 'meta-externalfetcher'],
  ['amazonbot', 'Amazonbot'],
  ['bytespider', 'Bytespider'],
  ['cohere-training-data-crawler', 'cohere-ai'],
  ['cohere-ai', 'cohere-ai'],
  ['duckassistbot', 'DuckAssistBot'],
  ['mistralai-user', 'MistralAI-User'],
  ['ccbot', 'CCBot'],
];

/** Canonical bot label for a user agent, or null for ordinary traffic. */
export function botFromUA(ua: string): string | null {
  const u = (ua || '').toLowerCase();
  if (!u) return null;
  for (const [token, label] of BOT_TOKENS) {
    if (u.includes(token)) return label;
  }
  return null;
}

export type PathKind = 'llms' | 'robots' | 'sitemap' | 'page';

export function classifyPath(path: string): PathKind {
  const p = (path || '').split('?')[0].toLowerCase();
  if (p === '/llms.txt' || p === '/llms-full.txt') return 'llms';
  if (p === '/robots.txt') return 'robots';
  if (p.includes('sitemap') && p.endsWith('.xml')) return 'sitemap';
  return 'page';
}

/**
 * One access-log line → event, or null when unparseable. Two formats:
 *
 *   1. Combined/CLF (nginx & apache default):
 *      1.2.3.4 - - [date] "GET /path HTTP/1.1" 200 123 "ref" "User Agent"
 *   2. A JSON object per line, with path/url and a user-agent field —
 *      what Cloudflare Logpush and most structured shippers emit.
 *
 * Unknown lines return null and are counted as ignored, never guessed at.
 */
const CLF = /"(?:GET|POST|HEAD)\s+(\S+)[^"]*"\s+\d{3}\s+\S+(?:\s+"[^"]*")?\s+"([^"]*)"/;

export function parseLogLine(line: string): BotEvent | null {
  const t = (line || '').trim();
  if (!t) return null;

  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const path = j.path ?? j.url ?? j.ClientRequestURI ?? j.request_uri;
      const ua = j.ua ?? j.user_agent ?? j.userAgent ?? j.ClientRequestUserAgent;
      if (typeof path === 'string' && typeof ua === 'string') return { ua, path };
    } catch { /* fall through to CLF */ }
    return null;
  }

  const m = t.match(CLF);
  if (!m) return null;
  return { path: m[1], ua: m[2] };
}

export interface BotDigest {
  hits: number;
  llms: number;
  robots: number;
  sitemap: number;
}

/** Aggregates events into per-bot counters; non-bot traffic is discarded. */
export function digestEvents(events: BotEvent[]): { bots: Map<string, BotDigest>; matched: number; ignored: number } {
  const bots = new Map<string, BotDigest>();
  let matched = 0, ignored = 0;
  for (const e of events) {
    const bot = botFromUA(e.ua);
    if (!bot) { ignored++; continue; }
    matched++;
    const d = bots.get(bot) ?? { hits: 0, llms: 0, robots: 0, sitemap: 0 };
    d.hits++;
    const kind = classifyPath(e.path);
    if (kind === 'llms') d.llms++;
    else if (kind === 'robots') d.robots++;
    else if (kind === 'sitemap') d.sitemap++;
    bots.set(bot, d);
  }
  return { bots, matched, ignored };
}

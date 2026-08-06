/**
 * entity.ts — brand detection inside free-form AI answers.
 *
 * This is the single most important file in the product. If matching is wrong,
 * every score above it is wrong. Two failure modes we design against:
 *
 *   FALSE NEGATIVE — the model wrote "Zeytin CRM'in fiyatları" and we missed it
 *                    because of the Turkish suffix, or wrote "Turk Hava Yollari"
 *                    without diacritics.
 *   FALSE POSITIVE — the brand is "Norma" and the model used the common noun
 *                    "norma" in an unrelated sentence.
 *
 * Strategy: cheap deterministic pass builds candidates, then an LLM judge
 * (see extract.ts) confirms them. Never trust the LLM alone; never trust
 * the regex alone.
 */

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Turkish casing is a classic trap: the default toLowerCase() turns
 * "İSTANBUL" into "i̇stanbul" (i + combining dot) and "I" into "i" rather
 * than "ı". We fold both dotted and dotless forms onto plain "i" so that
 * every spelling variant collapses to the same key.
 */
export function fold(input: string): string {
  return input
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks (ş→s, ğ→g, ö→o…)
    .replace(/ß/g, 'ss')
    .replace(/[''`´]/g, "'")
    .trim();
}

/** Collapse to comparison key: folded, no punctuation, no whitespace. */
export function key(input: string): string {
  return fold(input).replace(/[^a-z0-9]/g, '');
}

/* ------------------------------------------------------------------ */
/* Alias generation                                                    */
/* ------------------------------------------------------------------ */

export interface BrandInput {
  name: string;
  domain?: string | null;
  /** Operator-supplied variants from onboarding step 3. */
  variants?: string[];
}

/**
 * Derives the alias set we will look for. Deliberately conservative:
 * we only auto-generate forms that are unambiguous. Anything riskier
 * (nicknames, translations) must be added by the operator.
 */
export function buildAliases(brand: BrandInput): string[] {
  const out = new Set<string>();
  const add = (v?: string | null) => {
    const t = (v || '').trim();
    if (t.length >= 2) out.add(t);
  };

  add(brand.name);
  (brand.variants || []).forEach(add);

  // Diacritic-free spelling: "Şişli Öğüt" → "Sisli Ogut"
  const plain = brand.name
    .replace(/İ/g, 'I').replace(/ı/g, 'i')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U');
  if (plain !== brand.name) add(plain);

  const words = brand.name.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    add(words.join(''));                                  // "Zeytin CRM" → "ZeytinCRM"
    // Initialism only when every word starts with a letter and there are 2–4 words.
    if (words.length <= 4 && words.every(w => /^[\p{L}]/u.test(w))) {
      add(words.map(w => w[0]).join('').toUpperCase());
    }
  }

  if (brand.domain) {
    let host = brand.domain.trim();
    try { host = new URL(host.includes('://') ? host : `https://${host}`).hostname; } catch { /* keep as-is */ }
    host = host.replace(/^www\./, '');
    add(host);
    const label = host.split('.')[0];
    if (label && label.length >= 3) add(label);           // "bynogame.com" → "bynogame"
  }

  // Drop aliases that are too short or that are pure stopwords — they would
  // generate endless false positives.
  const banned = new Set(['ai', 'app', 'web', 'the', 'and', 've', 'ile', 'bir']);
  return [...out].filter(a => key(a).length >= 3 && !banned.has(key(a)));
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export interface Match {
  alias: string;
  index: number;
  /** The exact text as it appeared in the answer. */
  surface: string;
  /** Character window around the hit, used later by the LLM judge. */
  context: string;
}

/**
 * Turkish agglutinates: "Zeytin CRM'in", "Zeytinden", "ByNoGame'i".
 * We allow an apostrophe + suffix, or a bare suffix from a closed list.
 * We do NOT allow arbitrary trailing letters, because that is exactly how
 * "Norma" would swallow "normal".
 */
const SUFFIX = String.raw`(?:'|’)?(?:n[ıiuü]n|[ıiuü]n|[ıiuü]|e|a|de|da|te|ta|den|dan|ten|tan|le|la|ile|ye|ya|nin|nun|nün|ler|lar|lerin|ların|dir|dır|dur|dür|d[ıi]r)?`;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds candidate occurrences of any alias. Operates on the folded text but
 * reports offsets against the original string, so the surface form and the
 * context window stay human-readable.
 */
export function findMentions(answer: string, aliases: string[]): Match[] {
  const folded = fold(answer);
  const hits: Match[] = [];

  for (const alias of aliases) {
    const fa = fold(alias);
    if (!fa) continue;

    // Domain-like aliases are matched literally; word aliases allow suffixes.
    const isDomain = /\.[a-z]{2,}$/.test(fa);
    const body = escapeRe(fa).replace(/\s+/g, String.raw`[\s\-_.]*`);
    const pattern = isDomain
      ? String.raw`(?<![\w.])${body}(?![\w])`
      : String.raw`(?<![\p{L}\d])${body}${SUFFIX}(?![\p{L}\d])`;

    let re: RegExp;
    try { re = new RegExp(pattern, 'gu'); } catch { continue; }

    for (const m of folded.matchAll(re)) {
      const i = m.index ?? 0;
      hits.push({
        alias,
        index: i,
        surface: answer.slice(i, i + m[0].length),
        context: answer.slice(Math.max(0, i - 120), i + m[0].length + 160),
      });
    }
  }

  // De-duplicate overlapping hits, keeping the longest alias at each position.
  hits.sort((a, b) => a.index - b.index || b.surface.length - a.surface.length);
  const kept: Match[] = [];
  let cursor = -1;
  for (const h of hits) {
    if (h.index >= cursor) { kept.push(h); cursor = h.index + h.surface.length; }
  }
  return kept;
}

/**
 * Order of first appearance among a set of brands. Position 1 is the first
 * brand named in the answer; brands that never appear get 0.
 *
 * This feeds the prominence term π = 1 / log2(1 + rank).
 */
export function rankBrands(
  answer: string,
  brands: { id: string; aliases: string[] }[],
): Record<string, number> {
  const firstIndex: Record<string, number> = {};
  for (const b of brands) {
    const m = findMentions(answer, b.aliases);
    if (m.length) firstIndex[b.id] = m[0].index;
  }
  const ordered = Object.entries(firstIndex).sort((a, b) => a[1] - b[1]);
  const ranks: Record<string, number> = {};
  brands.forEach(b => { ranks[b.id] = 0; });
  ordered.forEach(([id], i) => { ranks[id] = i + 1; });
  return ranks;
}

/* ------------------------------------------------------------------ */
/* Citations                                                           */
/* ------------------------------------------------------------------ */

/** Pulls cited domains out of an answer, from markdown links and bare URLs. */
export function extractDomains(answer: string, structured?: { url?: string }[]): string[] {
  const urls = new Set<string>();
  (structured || []).forEach(c => c.url && urls.add(c.url));
  for (const m of answer.matchAll(/https?:\/\/[^\s)\]<>"']+/g)) urls.add(m[0]);

  const domains = new Set<string>();
  for (const u of urls) {
    try {
      domains.add(new URL(u).hostname.replace(/^www\./, '').toLowerCase());
    } catch { /* ignore malformed */ }
  }
  return [...domains];
}

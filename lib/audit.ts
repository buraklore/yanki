/**
 * audit.ts — the 58-factor GEO site audit.
 *
 * Design note that matters more than the factor list: we fetch every page
 * TWICE — once as a normal browser, once as GPTBot — and compare. Almost every
 * "we rank on Google but never appear in AI answers" case turns out to be a
 * page that is full of content for a browser and empty for a crawler that does
 * not execute JavaScript. No amount of schema fixes that.
 *
 * Everything here is deterministic HTTP + HTML parsing. No model calls, so an
 * audit costs fractions of a cent and can be re-run freely.
 */

import * as cheerio from 'cheerio';
import { safeFetch, assertPublicUrl } from './safe-fetch';

export type FactorStatus = 'pass' | 'partial' | 'fail';

export interface Factor {
  key: string;
  category: string;
  label: string;
  status: FactorStatus;
  detail: string;
  /** Copy-ready remediation, rendered in the panel behind the "Fix" button. */
  fix?: string;
}

/**
 * How many criteria a full audit scores.
 *
 * The number is quoted to customers on the marketing page and in the product
 * ("58 kriter, 6 başlıkta"), so it is a promise, not a detail. It is declared
 * here beside the checks themselves and asserted against the real output in
 * test/audit-count.test.ts — add or remove an `add()` call without updating
 * this constant and the suite fails.
 */
export const AUDIT_CRITERIA = 58;

export interface AuditResult {
  url: string;
  score: number;
  categories: { name: string; score: number; factors: Factor[] }[];
  factors: Factor[];
  fetched: { browserBytes: number; crawlerBytes: number; status: number; ttfbMs: number };
}

const UA_BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const UA_CRAWLER = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot';

const CATEGORY_WEIGHTS: Record<string, number> = {
  'Entity and identity clarity': 1,
  'Structured data': 1,
  'Answer-ready content structure': 1,
  'Citability': 1,
  'Accessibility and rendering': 1.4, // renders/robots failures block everything else
  'Freshness and maintenance': 0.8,
};

const SCORE: Record<FactorStatus, number> = { pass: 100, partial: 55, fail: 0 };

async function get(url: string, ua: string, timeoutMs = 15_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    // Every hop is re-validated: an open redirect on a public site would
    // otherwise be a free ride to an internal address.
    const { res, chain } = await safeFetch(url, {
      headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml' },
      signal: ac.signal,
    });
    const body = await res.text();
    return { body, status: res.status, chain, ttfbMs: Date.now() - started, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

/** Visible text length, used to compare browser vs crawler renders. */
function textLength(html: string) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  return $('body').text().replace(/\s+/g, ' ').trim().length;
}

function jsonLd($: cheerio.CheerioAPI): any[] {
  const out: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      Array.isArray(parsed) ? out.push(...parsed) : out.push(parsed);
      // @graph containers
      if (parsed['@graph']) out.push(...parsed['@graph']);
    } catch { /* invalid JSON-LD is itself a finding, handled below */ }
  });
  return out;
}

const hasType = (blocks: any[], t: string) =>
  blocks.some(b => {
    const ty = b?.['@type'];
    return Array.isArray(ty) ? ty.includes(t) : ty === t;
  });

export async function runAudit(rawUrl: string, brandName: string): Promise<AuditResult> {
  // Throws BlockedTargetError for private, loopback and metadata addresses.
  const parsed = await assertPublicUrl(rawUrl);
  const url = parsed.toString();
  const origin = parsed.origin;

  const [browser, crawler, robots, llms] = await Promise.all([
    get(url, UA_BROWSER),
    get(url, UA_CRAWLER),
    get(`${origin}/robots.txt`, UA_CRAWLER, 8000).catch(() => null),
    get(`${origin}/llms.txt`, UA_CRAWLER, 8000).catch(() => null),
  ]);

  // Sitemaps are frequently not at /sitemap.xml. robots.txt is the canonical
  // place to declare them, so read it there first and only then guess.
  const declared = (robots?.body || '').match(/^\s*sitemap:\s*(\S+)/gim)
    ?.map(l => l.split(/:\s*/).slice(1).join(':').trim()) ?? [];
  const sitemapCandidates = [...declared, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  let sitemap: Awaited<ReturnType<typeof get>> | null = null;
  for (const cand of sitemapCandidates) {
    try {
      const r = await get(cand, UA_CRAWLER, 8000);
      if (r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body)) { sitemap = r; break; }
    } catch { /* try the next candidate */ }
  }

  const $ = cheerio.load(browser.body);
  const $c = cheerio.load(crawler.body);
  const blocks = jsonLd($);
  const F: Factor[] = [];

  const add = (
    category: string, key: string, label: string,
    status: FactorStatus, detail: string, fix?: string,
  ) => F.push({ category, key, label, status, detail, fix });

  /* ---------------- Accessibility and rendering ------------------- */
  const CAT_R = 'Accessibility and rendering';

  const browserLen = textLength(browser.body);
  const crawlerLen = textLength(crawler.body);
  const ratio = browserLen ? crawlerLen / browserLen : 0;
  add(CAT_R, 'ssr', 'Content visible without JavaScript (SSR)',
    ratio > 0.8 ? 'pass' : ratio > 0.4 ? 'partial' : 'fail',
    `Crawler sees ${crawlerLen} chars vs ${browserLen} in a browser (${Math.round(ratio * 100)}%).`,
    ratio > 0.8 ? undefined :
`# Reproduce what an AI crawler sees
curl -sA "${UA_CRAWLER}" ${url} | grep -c "${brandName}"

# If this returns 0, the page is empty for AI crawlers.
# Fix: render critical routes server-side (SSR/SSG) and put product name,
# price and description into the first HTML response.`);

  const robotsTxt = robots?.status === 200 ? robots.body : '';
  const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Google-Extended'];
  const blocked = AI_BOTS.filter(b => {
    const sec = robotsTxt.split(/\n(?=User-agent:)/i).find(s => new RegExp(`user-agent:\\s*${b}`, 'i').test(s));
    return sec ? /disallow:\s*\/\s*$/im.test(sec) : /user-agent:\s*\*/i.test(robotsTxt) && /disallow:\s*\/\s*$/im.test(robotsTxt);
  });
  add(CAT_R, 'robots_ai', 'robots.txt open to AI bots',
    !robotsTxt ? 'partial' : blocked.length === 0 ? 'pass' : 'fail',
    !robotsTxt ? 'No robots.txt found.' :
      blocked.length ? `Blocked: ${blocked.join(', ')}.` : 'All major AI crawlers are allowed.',
    blocked.length ? AI_BOTS.map(b => `User-agent: ${b}\nAllow: /\n`).join('\n') + `\nSitemap: ${origin}/sitemap.xml` : undefined);

  add(CAT_R, 'llms_txt', 'llms.txt published',
    llms?.status === 200 && llms.body.length > 40 ? 'pass' : 'fail',
    llms?.status === 200 ? 'Found.' : 'Not found at /llms.txt.',
    llms?.status === 200 ? undefined :
`# ${brandName}

> One-paragraph description of what ${brandName} does.

## Key pages
- [Home](${origin}): brand overview
- [Products](${origin}/products)
- [FAQ](${origin}/faq)

## Contact
- Web: ${origin}`);

  add(CAT_R, 'sitemap', 'sitemap.xml up to date',
    sitemap?.status === 200 ? (/<lastmod>/.test(sitemap.body) ? 'pass' : 'partial') : 'fail',
    sitemap?.status === 200 ? (/<lastmod>/.test(sitemap.body) ? 'Present with lastmod.' : 'Present but no lastmod dates.') : 'Not found.');

  add(CAT_R, 'status', 'No 4xx/5xx errors', browser.status < 400 ? 'pass' : 'fail', `HTTP ${browser.status}.`);
  add(CAT_R, 'redirects', 'Short redirect chains',
    browser.chain.length <= 2 ? 'pass' : browser.chain.length === 3 ? 'partial' : 'fail',
    `Chain: ${browser.chain.join(' → ')}.`);

  const canonical = $('link[rel="canonical"]').attr('href');
  add(CAT_R, 'canonical', 'Correct canonical',
    canonical ? 'pass' : 'fail', canonical ? canonical : 'No canonical link.',
    canonical ? undefined : `<link rel="canonical" href="${url}">`);

  add(CAT_R, 'ttfb', 'TTFB < 800ms',
    browser.ttfbMs < 800 ? 'pass' : browser.ttfbMs < 2000 ? 'partial' : 'fail', `${browser.ttfbMs}ms.`);
  add(CAT_R, 'weight', 'Reasonable page weight',
    browser.body.length < 400_000 ? 'pass' : 'partial', `${Math.round(browser.body.length / 1024)} KB of HTML.`);
  add(CAT_R, 'cdn_block', 'No CDN bot blocking',
    crawler.status < 400 ? 'pass' : 'fail',
    crawler.status < 400 ? 'Crawler UA served normally.' : `Crawler UA got HTTP ${crawler.status} — a WAF or CDN rule is blocking AI bots.`);

  /* ---------------- Entity and identity clarity ------------------- */
  const CAT_E = 'Entity and identity clarity';
  const org = blocks.find(b => ['Organization', 'Corporation', 'LocalBusiness'].includes(b?.['@type']));

  add(CAT_E, 'org_schema', 'Organization schema present', org ? 'pass' : 'fail',
    org ? `Found @type ${org['@type']}.` : 'No Organization schema.',
    org ? undefined : JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Organization',
      name: brandName, url: origin,
      sameAs: ['https://www.linkedin.com/company/…', 'https://www.youtube.com/@…'],
    }, null, 2));

  const sameAs: string[] = org?.sameAs ? (Array.isArray(org.sameAs) ? org.sameAs : [org.sameAs]) : [];
  add(CAT_E, 'sameas', 'sameAs link graph',
    sameAs.length >= 3 ? 'pass' : sameAs.length ? 'partial' : 'fail', `${sameAs.length} sameAs links.`);

  const title = $('title').text();
  add(CAT_E, 'name_consistency', 'Consistent brand name usage',
    title.toLowerCase().includes(brandName.toLowerCase().split(' ')[0]) ? 'pass' : 'partial',
    `Title: "${title.slice(0, 80)}".`);

  add(CAT_E, 'logo', 'Logo ImageObject markup', org?.logo ? 'pass' : 'fail',
    org?.logo ? 'Present.' : 'No logo in Organization schema.');
  add(CAT_E, 'contact', 'Founder / contact details',
    org?.address || org?.contactPoint || $('a[href^="mailto:"], a[href^="tel:"]').length ? 'pass' : 'fail',
    'Checked schema address/contactPoint and mailto/tel links.');
  add(CAT_E, 'wikidata', 'Wikidata or Wikipedia entry',
    sameAs.some(s => /wikipedia|wikidata/i.test(s)) ? 'pass' : 'fail',
    'Looked for a wiki entity in sameAs.');
  add(CAT_E, 'gbp', 'Google Business profile consistency',
    sameAs.some(s => /google\.com\/maps|g\.page/i.test(s)) ? 'pass' : 'partial', 'Heuristic via sameAs.');
  add(CAT_E, 'linkedin', 'LinkedIn company page match',
    sameAs.some(s => /linkedin\.com\/company/i.test(s)) ? 'pass' : 'fail', 'Heuristic via sameAs.');
  add(CAT_E, 'variants', 'Brand name variants appear on page',
    (org?.alternateName ? 'pass' : 'partial'),
    org?.alternateName ? 'alternateName present.' : 'No alternateName — variant spellings will not be linked to the entity.');

  /* ---------------- Structured data -------------------------------- */
  const CAT_S = 'Structured data';
  const invalidLd = $('script[type="application/ld+json"]').length > blocks.length;
  const S: [string, string, boolean][] = [
    ['product', 'Product schema', hasType(blocks, 'Product')],
    ['offer', 'Offer / price markup', hasType(blocks, 'Offer') || blocks.some(b => b?.offers)],
    ['faq', 'FAQPage schema', hasType(blocks, 'FAQPage')],
    ['howto', 'HowTo schema', hasType(blocks, 'HowTo')],
    ['article', 'Article schema', hasType(blocks, 'Article') || hasType(blocks, 'BlogPosting')],
    ['breadcrumb', 'BreadcrumbList', hasType(blocks, 'BreadcrumbList')],
    ['author', 'author + Person schema', blocks.some(b => b?.author)],
    ['dates', 'datePublished / dateModified', blocks.some(b => b?.datePublished || b?.dateModified)],
    ['review', 'Review or AggregateRating', hasType(blocks, 'Review') || blocks.some(b => b?.aggregateRating)],
    ['website', 'WebSite + SearchAction', hasType(blocks, 'WebSite')],
  ];
  S.forEach(([k, label, ok]) => add(CAT_S, k, label, ok ? 'pass' : 'fail', ok ? 'Present.' : 'Not found.'));
  add(CAT_S, 'ld_valid', 'No schema validation errors', invalidLd ? 'fail' : 'pass',
    invalidLd ? 'At least one JSON-LD block failed to parse.' : 'All JSON-LD blocks parsed.');
  add(CAT_S, 'ld_format', 'JSON-LD format used', blocks.length ? 'pass' : 'fail',
    blocks.length ? `${blocks.length} blocks.` : 'No JSON-LD; microdata alone is weaker for models.');

  /* ---------------- Answer-ready content structure ------------------ */
  const CAT_C = 'Answer-ready content structure';
  const h1 = $('h1').first().text().trim();
  const headings = $('h2, h3').map((_, el) => $(el).text().trim()).get();
  // The first <p> is very often an empty wrapper or a cookie notice. Take the
  // first one that actually reads like a paragraph.
  const firstPara = $('main p, article p, body p')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get()
    .find(t => t.length > 60) ?? '';
  const words = firstPara.split(/\s+/).filter(Boolean).length;
  const questionHeads = headings.filter(h => /\?|^(what|how|why|when|which|nedir|nasıl|neden|hangi)/i.test(h));

  add(CAT_C, 'lead_answer', '40–60 word direct answer in first paragraph',
    words >= 30 && words <= 90 ? 'pass' : words > 0 ? 'partial' : 'fail',
    `First paragraph is ${words} words.`,
    words >= 30 && words <= 90 ? undefined :
`<h1>What is ${brandName}?</h1>
<p>${brandName} is … (40–60 words, direct and definitional. This is the
   passage models quote, so it must stand alone without the rest of the page.)</p>`);
  add(CAT_C, 'question_heads', 'H2/H3 headings in question form',
    questionHeads.length >= 2 ? 'pass' : questionHeads.length ? 'partial' : 'fail',
    `${questionHeads.length} of ${headings.length} headings are questions.`);
  add(CAT_C, 'definition', 'Definition block present',
    /\b(is|are|means|nedir|demektir)\b/i.test(firstPara) ? 'pass' : 'partial', 'Heuristic on the lead paragraph.');
  add(CAT_C, 'table', 'Comparison table', $('table').length ? 'pass' : 'fail', `${$('table').length} tables.`);
  add(CAT_C, 'lists', 'Bullet lists used', $('ul li, ol li').length >= 3 ? 'pass' : 'partial', `${$('ul li, ol li').length} list items.`);
  add(CAT_C, 'one_topic', 'One topic per page', $('h1').length === 1 ? 'pass' : 'fail', `${$('h1').length} H1 elements.`);
  add(CAT_C, 'chunkable', 'Content is chunkable',
    headings.length >= 3 ? 'pass' : 'partial', `${headings.length} section headings.`);
  add(CAT_C, 'semantic', 'Meaningful section/article tags',
    $('main, article, section').length ? 'pass' : 'fail', 'Checked main/article/section.');
  add(CAT_C, 'hierarchy', 'Heading hierarchy is not broken',
    h1 && $('h3').length && !$('h2').length ? 'fail' : 'pass', 'Checked for H3 without H2.');
  add(CAT_C, 'summary_box', 'Highlighted summary box',
    $('blockquote, [class*=summary], [class*=tldr], [class*=ozet]').length ? 'pass' : 'partial', 'Heuristic on class names.');
  const imgs = $('img');
  const withAlt = imgs.filter((_, el) => ($(el).attr('alt') || '').trim().length > 3).length;
  add(CAT_C, 'alt', 'Meaningful image alt text',
    !imgs.length ? 'partial' : withAlt / imgs.length > 0.8 ? 'pass' : 'fail',
    `${withAlt}/${imgs.length} images have descriptive alt text.`);

  /* ---------------- Citability ------------------------------------- */
  const CAT_Q = 'Citability';
  const bodyText = $('body').text();
  const NUMERIC_CLAIM = new RegExp(
    // "1.200 TL", "%45", "45%", "3,5 milyon kullanıcı", "$2M", "12 kg"
    '(?:[%$€₺]\\s?\\d[\\d.,]*)' +
    '|(?:\\b\\d[\\d.,]*\\s?(?:%|percent|bin|milyon|milyar|million|billion|k\\b|m\\b|' +
    'TL|₺|\\$|€|USD|EUR|kg|km|gr|lt|adet|kişi|users|müşteri|customers|saat|dakika|gün|yıl|years?|days?)\\b)',
    'gi');
  const numbers = (bodyText.match(NUMERIC_CLAIM) || []).length;
  const outLinks = $('a[href^="http"]').filter((_, el) => {
    try { return new URL($(el).attr('href')!).hostname !== new URL(url).hostname; } catch { return false; }
  }).length;

  add(CAT_Q, 'stats', 'Original statistics or data',
    numbers >= 5 ? 'pass' : numbers >= 1 ? 'partial' : 'fail', `${numbers} quantified claims found.`);
  add(CAT_Q, 'sources', 'External source citations',
    outLinks >= 2 ? 'pass' : outLinks ? 'partial' : 'fail', `${outLinks} outbound links.`);
  add(CAT_Q, 'quote', 'Expert opinion or quote', $('blockquote, q, cite').length ? 'pass' : 'fail', 'Checked blockquote/q/cite.');
  add(CAT_Q, 'claim_density', 'Density of numeric claims',
    bodyText.length ? (numbers / (bodyText.length / 1000) > 1 ? 'pass' : 'partial') : 'fail',
    `${(numbers / Math.max(1, bodyText.length / 1000)).toFixed(2)} claims per 1k chars.`);
  add(CAT_Q, 'terminology', 'Unique terminology defined',
    $('dl dt, [class*=glossary]').length ? 'pass' : 'partial', 'Checked definition lists.');
  add(CAT_Q, 'pubdate', 'Publication date visible',
    $('time[datetime]').length || blocks.some(b => b?.datePublished) ? 'pass' : 'fail', 'Checked <time> and schema.');
  add(CAT_Q, 'author_bio', 'Author biography',
    $('[rel=author], [class*=author]').length ? 'pass' : 'fail', 'Heuristic on author markup.');
  add(CAT_Q, 'updates', 'Update log',
    blocks.some(b => b?.dateModified) ? 'pass' : 'partial', 'Checked dateModified.');

  /* ---------------- Freshness and maintenance ---------------------- */
  const CAT_F = 'Freshness and maintenance';
  const modified = blocks.map(b => b?.dateModified).filter(Boolean)[0];
  const ageDays = modified ? (Date.now() - Date.parse(modified)) / 86_400_000 : null;

  add(CAT_F, 'recent', 'Updated in the last 90 days',
    ageDays === null ? 'fail' : ageDays < 90 ? 'pass' : ageDays < 365 ? 'partial' : 'fail',
    ageDays === null ? 'No dateModified.' : `Last modified ${Math.round(ageDays)} days ago.`);
  add(CAT_F, 'date_markers', 'Date markers visible', $('time').length ? 'pass' : 'partial', `${$('time').length} time elements.`);
  add(CAT_F, 'broken', 'No broken links', 'partial', 'Deep link check runs in the crawl job, not the single-page audit.');
  add(CAT_F, 'orphans', 'No orphan pages', 'partial', 'Requires the sitemap + internal link graph.');
  add(CAT_F, 'archive', 'Archived content labelled', 'partial', 'Requires the full crawl.');
  add(CAT_F, 'lastmod', 'Sitemap lastmod correct',
    sitemap?.status === 200 && /<lastmod>/.test(sitemap.body) ? 'pass' : 'fail', 'Checked sitemap.xml.');
  add(CAT_F, 'calendar', 'Evidence of a content calendar', 'partial', 'Requires publication history.');
  add(CAT_F, 'stale_stats', 'Outdated statistics refreshed',
    /\b20(1[0-9]|2[0-3])\b/.test(bodyText) && !/\b202[5-9]\b/.test(bodyText) ? 'fail' : 'pass',
    'Looked for years older than the current period without a recent one.');

  /* ---------------- scoring ---------------------------------------- */
  const byCat = new Map<string, Factor[]>();
  F.forEach(f => { (byCat.get(f.category) ?? byCat.set(f.category, []).get(f.category)!).push(f); });

  const categories = [...byCat.entries()].map(([name, factors]) => ({
    name,
    score: factors.reduce((a, f) => a + SCORE[f.status], 0) / factors.length,
    factors,
  }));

  const wsum = categories.reduce((a, c) => a + (CATEGORY_WEIGHTS[c.name] ?? 1), 0);
  const score = categories.reduce((a, c) => a + c.score * (CATEGORY_WEIGHTS[c.name] ?? 1), 0) / wsum;

  return {
    url,
    score,
    categories,
    factors: F,
    fetched: {
      browserBytes: browser.body.length,
      crawlerBytes: crawler.body.length,
      status: browser.status,
      ttfbMs: browser.ttfbMs,
    },
  };
}

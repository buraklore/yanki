import { describe, it, expect } from 'vitest';
import { botFromUA, classifyPath, parseLogLine, digestEvents } from '../lib/bots';

describe('botFromUA', () => {
  it('recognises the crawlers the robots generator names, case-insensitively', () => {
    expect(botFromUA('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)')).toBe('GPTBot');
    expect(botFromUA('mozilla/5.0 claudebot/1.0')).toBe('ClaudeBot');
    expect(botFromUA('PerplexityBot/1.0 (+https://perplexity.ai/perplexitybot)')).toBe('PerplexityBot');
    expect(botFromUA('Google-Extended')).toBe('Google-Extended');
  });

  it('prefers the specific token over its substring sibling', () => {
    // "Claude-SearchBot" contains no "claudebot" token collision, but
    // "OAI-SearchBot" vs "gptbot" style overlaps must resolve specifically.
    expect(botFromUA('Mozilla/5.0 Claude-SearchBot/1.0')).toBe('Claude-SearchBot');
    expect(botFromUA('OAI-SearchBot/1.0; +https://openai.com/searchbot')).toBe('OAI-SearchBot');
  });

  it('returns null for ordinary browsers and empty agents', () => {
    expect(botFromUA('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0')).toBeNull();
    expect(botFromUA('')).toBeNull();
  });
});

describe('classifyPath', () => {
  it('flags the crawl-facing files, query strings ignored', () => {
    expect(classifyPath('/llms.txt')).toBe('llms');
    expect(classifyPath('/llms.txt?v=2')).toBe('llms');
    expect(classifyPath('/robots.txt')).toBe('robots');
    expect(classifyPath('/sitemap.xml')).toBe('sitemap');
    expect(classifyPath('/sitemap-products.xml')).toBe('sitemap');
    expect(classifyPath('/blog/muhasebe-rehberi')).toBe('page');
  });
});

describe('parseLogLine', () => {
  it('parses an nginx combined line', () => {
    const line = '66.249.66.1 - - [21/Sep/2026:10:00:00 +0300] "GET /llms.txt HTTP/1.1" 200 512 "-" "Mozilla/5.0 (compatible; GPTBot/1.2)"';
    expect(parseLogLine(line)).toEqual({ path: '/llms.txt', ua: 'Mozilla/5.0 (compatible; GPTBot/1.2)' });
  });

  it('parses a common (no-referrer) line too', () => {
    const line = '1.2.3.4 - - [21/Sep/2026:10:00:00 +0300] "GET /urunler HTTP/1.1" 200 1024 "ClaudeBot/1.0"';
    expect(parseLogLine(line)).toEqual({ path: '/urunler', ua: 'ClaudeBot/1.0' });
  });

  it('parses a JSON log line with common field names', () => {
    const line = JSON.stringify({ path: '/robots.txt', user_agent: 'PerplexityBot/1.0' });
    expect(parseLogLine(line)).toEqual({ path: '/robots.txt', ua: 'PerplexityBot/1.0' });
  });

  it('returns null for garbage instead of guessing', () => {
    expect(parseLogLine('not a log line at all')).toBeNull();
    expect(parseLogLine('{"broken json"')).toBeNull();
    expect(parseLogLine('')).toBeNull();
  });
});

describe('digestEvents', () => {
  it('counts only bots, splits the special files, reports the rest as ignored', () => {
    const { bots, matched, ignored } = digestEvents([
      { ua: 'GPTBot/1.2', path: '/llms.txt' },
      { ua: 'GPTBot/1.2', path: '/blog/x' },
      { ua: 'ClaudeBot/1.0', path: '/robots.txt' },
      { ua: 'Chrome/126', path: '/' },
    ]);
    expect(matched).toBe(3);
    expect(ignored).toBe(1);
    expect(bots.get('GPTBot')).toEqual({ hits: 2, llms: 1, robots: 0, sitemap: 0 });
    expect(bots.get('ClaudeBot')).toEqual({ hits: 1, llms: 0, robots: 1, sitemap: 0 });
  });
});

import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * safeFetch.ts — outbound request guard.
 *
 * The audit takes a URL from the user and fetches it. Without this file, a
 * customer could point it at 169.254.169.254 and read the cloud metadata
 * service — which on AWS and GCP hands out IAM credentials — or at
 * 127.0.0.1:3000 to make our own server call itself with its own cookies.
 * That is server-side request forgery, and an audit tool is the textbook
 * place for it.
 *
 * The check has to happen after DNS resolution, not before. `evil.com` can
 * have an A record pointing at 127.0.0.1, so validating the hostname string
 * alone proves nothing.
 */

const BLOCKED_V4 = [
  { net: '0.0.0.0', bits: 8, why: 'this host' },
  { net: '10.0.0.0', bits: 8, why: 'private network' },
  { net: '100.64.0.0', bits: 10, why: 'carrier-grade NAT' },
  { net: '127.0.0.0', bits: 8, why: 'loopback' },
  { net: '169.254.0.0', bits: 16, why: 'link-local / cloud metadata' },
  { net: '172.16.0.0', bits: 12, why: 'private network' },
  { net: '192.0.0.0', bits: 24, why: 'IETF protocol assignments' },
  { net: '192.168.0.0', bits: 16, why: 'private network' },
  { net: '198.18.0.0', bits: 15, why: 'benchmarking' },
  { net: '224.0.0.0', bits: 4, why: 'multicast' },
  { net: '240.0.0.0', bits: 4, why: 'reserved' },
];

const toInt = (ip: string) =>
  ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;

function v4Blocked(ip: string): string | null {
  const addr = toInt(ip);
  for (const b of BLOCKED_V4) {
    const mask = b.bits === 0 ? 0 : (~0 << (32 - b.bits)) >>> 0;
    if ((addr & mask) === (toInt(b.net) & mask)) return b.why;
  }
  return null;
}

function v6Blocked(ip: string): string | null {
  const a = ip.toLowerCase();
  if (a === '::1' || a === '::') return 'loopback';
  if (a.startsWith('fe80')) return 'link-local';
  if (a.startsWith('fc') || a.startsWith('fd')) return 'unique local';
  // ::ffff:127.0.0.1 style mapped addresses
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Blocked(mapped[1]);
  return null;
}

export class BlockedTargetError extends Error {}

/**
 * Validates a user-supplied URL and returns a normalised one. Throws
 * BlockedTargetError with a message safe to show the customer.
 */
export async function assertPublicUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    throw new BlockedTargetError('That does not look like a valid web address.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedTargetError('Only http and https addresses can be audited.');
  }
  if (url.username || url.password) {
    throw new BlockedTargetError('Addresses with embedded credentials are not allowed.');
  }
  if (url.port && !['', '80', '443', '8080', '8443'].includes(url.port)) {
    throw new BlockedTargetError('Only standard web ports can be audited.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  // A literal IP needs no lookup; a hostname does, because DNS is exactly how
  // this check gets bypassed.
  const literals = net.isIP(host) ? [host] : [];
  if (!literals.length) {
    let records;
    try {
      records = await lookup(host, { all: true });
    } catch {
      throw new BlockedTargetError(`Could not resolve ${host}.`);
    }
    if (!records.length) throw new BlockedTargetError(`Could not resolve ${host}.`);
    literals.push(...records.map(r => r.address));
  }

  for (const ip of literals) {
    const why = net.isIPv6(ip) ? v6Blocked(ip) : v4Blocked(ip);
    if (why) {
      throw new BlockedTargetError(
        `${host} resolves to a ${why} address. Only public websites can be audited.`);
    }
  }

  return url;
}

/**
 * fetch with the guard applied, and redirects followed manually so each hop is
 * re-validated. An open redirect on a public site is otherwise a free pass to
 * an internal address.
 */
export async function safeFetch(
  input: string,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<{ res: Response; url: string; chain: number[] }> {
  const max = init.maxRedirects ?? 5;
  let current = (await assertPublicUrl(input)).toString();
  const chain: number[] = [];

  for (let hop = 0; hop <= max; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    chain.push(res.status);
    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return { res, url: current, chain };
    }
    const loc = res.headers.get('location');
    if (!loc) return { res, url: current, chain };
    current = (await assertPublicUrl(new URL(loc, current).toString())).toString();
  }
  throw new BlockedTargetError('Too many redirects.');
}

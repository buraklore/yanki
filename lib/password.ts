import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;
const KEYLEN = 64;

/**
 * scrypt from node:crypto rather than bcrypt/argon2: no native module, so the
 * function bundle stays small and the build never breaks on a platform that
 * lacks prebuilt binaries. Parameters are the Node defaults (N=16384),
 * which is ~100ms per hash — slow enough to matter, fast enough for a login.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = Buffer.from(keyB64, 'base64');
  const candidate = await scryptAsync(plain.normalize('NFKC'), Buffer.from(saltB64, 'base64'), key.length);
  // Constant-time: a length mismatch must not short-circuit either.
  return key.length === candidate.length && timingSafeEqual(key, candidate);
}

/** Minimum viable policy. Anything stricter just pushes people to "Passw0rd!". */
export function passwordProblem(plain: string): string | null {
  if (plain.length < 10) return 'Password must be at least 10 characters.';
  if (/^\d+$/.test(plain)) return 'Password cannot be only digits.';
  return null;
}

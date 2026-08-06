import { sql } from './db';
import { HttpError } from './auth';

/**
 * rate-limit.ts — fixed-window limiter backed by Postgres.
 *
 * Why the database and not an in-memory map: on Vercel every request may land
 * on a different lambda instance, so an in-memory counter limits nothing. Redis
 * would be faster, but it is one more service to run and pay for, and these
 * limits are measured in tens per hour, not thousands per second.
 *
 * Without this, `/api/auth/login` is an unlimited password oracle and
 * `/api/auth/register` lets one script create accounts until the provider bill
 * becomes someone else's problem.
 */

export interface Limit {
  /** Requests permitted inside the window. */
  max: number;
  /** Window length in seconds. */
  window: number;
}

export const LIMITS = {
  login:    { max: 10, window: 15 * 60 },   // 10 attempts per IP per 15 min
  register: { max: 5,  window: 60 * 60 },   // 5 accounts per IP per hour
  audit:    { max: 20, window: 60 * 60 },   // 20 crawls per org per hour
  scan:     { max: 6,  window: 60 * 60 },
} satisfies Record<string, Limit>;

/** Client IP, trusting the proxy header Vercel sets. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Counts one hit and throws 429 once the window is full. The bucket key should
 * identify the actor: an IP for anonymous endpoints, an org id for authenticated
 * ones.
 */
export async function enforce(bucket: keyof typeof LIMITS, key: string) {
  const { max, window } = LIMITS[bucket];
  const windowStart = new Date(Math.floor(Date.now() / (window * 1000)) * window * 1000);

  const [row] = await sql`
    insert into rate_limits (bucket, key, window_start, hits)
    values (${bucket}, ${key}, ${windowStart}, 1)
    on conflict (bucket, key, window_start)
      do update set hits = rate_limits.hits + 1
    returning hits`;

  if (row.hits > max) {
    const retryIn = Math.ceil((windowStart.getTime() + window * 1000 - Date.now()) / 1000);
    throw new HttpError(429,
      `Too many attempts. Try again in ${retryIn > 60 ? Math.ceil(retryIn / 60) + ' minutes' : retryIn + ' seconds'}.`);
  }
}

/** Old windows are dead weight; called opportunistically from the drain cron. */
export async function pruneRateLimits() {
  await sql`delete from rate_limits where window_start < now() - interval '2 days'`;
}

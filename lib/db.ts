import postgres from 'postgres';

/**
 * Lazy singleton. Creating the client at module load would crash any route
 * that merely imports this file when DATABASE_URL is missing — including the
 * build. We only connect when a query is actually issued.
 */
let client: ReturnType<typeof postgres> | null = null;

export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = postgres(url, {
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 15,
      // Neon and Supabase both require TLS; local dev usually does not.
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
      transform: { undefined: null },
    });
  }
  return client;
}

/** Convenience so call sites read as `sql\`select …\``. */
export const sql: ReturnType<typeof postgres> = new Proxy((() => {}) as never, {
  apply: (_t, _this, args: never[]) => (db() as never as (...a: never[]) => unknown)(...args),
  get: (_t, prop) => (db() as never as Record<string | symbol, unknown>)[prop],
}) as never;

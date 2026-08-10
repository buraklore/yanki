import postgres from 'postgres';

/**
 * Lazy singleton. Creating the client at module load would crash any route
 * that merely imports this file when DATABASE_URL is missing — including the
 * build. We only connect when a query is actually issued.
 */
let client: ReturnType<typeof postgres> | null = null;

/**
 * Supabase's transaction pooler (port 6543) is PgBouncer in transaction mode:
 * a connection is handed back to the pool after every statement, so the named
 * prepared statement created on one backend is gone by the time the next
 * statement looks for it. postgres.js prepares by default, which produces a
 * scattergun of unrelated-looking failures — "prepared statement ... does not
 * exist", "malformed array literal", and buffer offset RangeErrors from a
 * desynchronised protocol stream. All four are the same fault.
 *
 * Disabling prepare costs a little planning time per query and makes every
 * pooler mode work. The direct connection and the session pooler are
 * unaffected by the setting, so this is safe everywhere rather than a
 * Supabase-specific hack.
 */
const usesTransactionPooler = (url: string) =>
  /:6543\b/.test(url) || /pgbouncer=true/i.test(url) || process.env.PG_NO_PREPARE === '1';

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
      prepare: !usesTransactionPooler(url),
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

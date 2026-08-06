import { sql } from '@/lib/db';
import { ENGINES } from '@/lib/engines';

export const dynamic = 'force-dynamic';

/**
 * Setup check, not just a liveness ping.
 *
 * A health endpoint that only returns {ok:true} is worse than none during
 * setup: it tells an operator everything is fine while the database is
 * unreachable and no provider key is set. This one reports what is actually
 * configured, so "what did I miss" is answerable from a browser.
 *
 * It reveals no secrets — only whether each variable is present.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  checks.server = { ok: true, detail: 'Running' };

  // Database
  if (!process.env.DATABASE_URL) {
    checks.database = { ok: false, detail: 'DATABASE_URL is not set' };
  } else {
    try {
      const [{ n }] = await sql`select count(*)::int as n from engines`;
      checks.database = n > 0
        ? { ok: true, detail: `Connected · ${n} engines registered` }
        : { ok: false, detail: 'Connected, but the schema has not been applied (db/schema.sql)' };
    } catch (e) {
      const msg = (e as Error).message;
      checks.database = {
        ok: false,
        detail: /relation .* does not exist/i.test(msg)
          ? 'Connected, but the schema has not been applied (db/schema.sql)'
          : `Cannot connect: ${msg.slice(0, 120)}`,
      };
    }
  }

  // Cron secret
  checks.cronSecret = process.env.CRON_SECRET
    ? { ok: true, detail: 'Set' }
    : { ok: false, detail: 'CRON_SECRET is not set — scheduled scans will refuse to run' };

  // Providers
  const configured = ENGINES.filter(e => e.enabled());
  checks.providers = configured.length
    ? { ok: true, detail: `${configured.length} configured: ${configured.map(e => e.label).join(', ')}` }
    : { ok: false, detail: 'No provider key set — scans cannot run. Add OPENAI_API_KEY and/or ANTHROPIC_API_KEY.' };

  if (process.env.MOCK_ENGINES === '1') {
    checks.mock = { ok: false, detail: 'MOCK_ENGINES is on — answers are synthetic. Remove this variable.' };
  }

  const ready = Object.values(checks).every(c => c.ok);

  return Response.json(
    {
      ok: ready,
      ready,
      nextStep: ready
        ? 'Setup complete. Open /kayit to create your account.'
        : Object.entries(checks).find(([, c]) => !c.ok)?.[1].detail,
      checks,
      ts: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}

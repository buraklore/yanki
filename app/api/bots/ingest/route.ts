import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/auth';
import { enforce } from '@/lib/rate-limit';
import { parseLogLine, digestEvents, type BotEvent } from '@/lib/bots';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * bots/ingest — machine-to-machine log delivery.
 *
 * Authenticated by the workspace's ingest token, not a session: the caller is
 * a cron job on the customer's server, and asking it to log in would mean
 * storing a YANKI password in a shell script. The token grants exactly one
 * capability — incrementing this workspace's bot counters — so leaking it is
 * an annoyance, not a breach; rotation is one click in the panel.
 *
 * Raw lines are parsed and DROPPED. Only per-day, per-bot counters persist:
 * no IPs, no visitor paths, nothing a privacy review has to think about.
 */
const Body = z.object({
  lines: z.array(z.string().max(4000)).max(2000).optional(),
  events: z.array(z.object({ ua: z.string().max(500), path: z.string().max(2000) }))
    .max(5000).optional(),
}).refine(b => (b.lines?.length || 0) + (b.events?.length || 0) > 0,
  { message: 'lines or events required' });

export const POST = handler(async (req) => {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token.length < 20) throw new HttpError(401, 'ingest token required');

  const [ws] = await sql`select id from workspaces where ingest_token = ${token}`;
  if (!ws) throw new HttpError(401, 'invalid ingest token');
  await enforce('botIngest', ws.id as string);

  const b = Body.parse(await req.json());

  const events: BotEvent[] = (b.events ?? []).map(e => ({ ua: e.ua ?? '', path: e.path ?? '' }));
  let unparsed = 0;
  for (const line of b.lines ?? []) {
    const e = parseLogLine(line);
    if (e) events.push(e); else unparsed++;
  }

  const { bots, matched, ignored } = digestEvents(events);

  for (const [bot, d] of bots) {
    await sql`
      insert into bot_hits (workspace_id, day, bot, hits, llms_hits, robots_hits, sitemap_hits)
      values (${ws.id}, current_date, ${bot}, ${d.hits}, ${d.llms}, ${d.robots}, ${d.sitemap})
      on conflict (workspace_id, day, bot) do update set
        hits = bot_hits.hits + excluded.hits,
        llms_hits = bot_hits.llms_hits + excluded.llms_hits,
        robots_hits = bot_hits.robots_hits + excluded.robots_hits,
        sitemap_hits = bot_hits.sitemap_hits + excluded.sitemap_hits,
        last_seen = now()`;
  }

  return Response.json({
    ok: true,
    matched,               // events from a known AI crawler
    ignored,               // ordinary traffic, discarded
    unparsed,              // lines no parser understood
    bots: Object.fromEntries([...bots.entries()].map(([k, v]) => [k, v.hits])),
  });
});

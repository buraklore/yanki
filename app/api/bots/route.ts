import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * bots — what AI crawlers actually do on the customer's site.
 *
 * The screen answers three questions the score cannot: is anyone crawling us
 * at all, did the llms.txt / robots.txt we generated get fetched, and when
 * did that start relative to the date we generated the file. That last join
 * is why the response carries the generated_content dates: publish date →
 * first crawl is the feedback loop this feature exists to close.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') ?? '';
  await requireWorkspace(s, workspaceId);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days') ?? 30)));

  // The token is generated on first view so the setup card always has one to
  // show; regenerate is a separate, explicit action.
  let [{ ingest_token: token }] = await sql`
    select ingest_token from workspaces where id = ${workspaceId}`;
  if (!token) {
    token = randomBytes(24).toString('hex');
    await sql`update workspaces set ingest_token = ${token}
               where id = ${workspaceId} and ingest_token is null`;
    [{ ingest_token: token }] = await sql`
      select ingest_token from workspaces where id = ${workspaceId}`;
  }

  const rows = await sql`
    select bot,
           sum(hits)::int as hits,
           sum(hits) filter (where day > current_date - 7)::int as hits7,
           sum(llms_hits)::int as llms,
           sum(robots_hits)::int as robots,
           sum(sitemap_hits)::int as sitemap,
           min(first_seen) as first_seen,
           max(last_seen) as last_seen
      from bot_hits
     where workspace_id = ${workspaceId} and day > current_date - ${days}::int
     group by bot order by sum(hits) desc`;

  const series = await sql`
    select day, sum(hits)::int as hits from bot_hits
     where workspace_id = ${workspaceId} and day > current_date - ${days}::int
     group by day order by day`;

  // Publish anchors: when were the crawl-facing files last generated.
  const gens = await sql`
    select kind, max(created_at) as at from generated_content
     where workspace_id = ${workspaceId} and kind in ('llms', 'robots')
     group by kind`;

  return Response.json({ token, days, bots: rows, series, generated: gens });
});

const Rotate = z.object({ workspaceId: z.string().uuid(), action: z.literal('rotate') });

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Rotate.parse(await req.json());
  await requireWorkspace(s, b.workspaceId);

  const token = randomBytes(24).toString('hex');
  await sql`update workspaces set ingest_token = ${token} where id = ${b.workspaceId}`;
  return Response.json({ token });
});

import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { drainJobs } from '@/lib/scan';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({ workspaceId: z.string().uuid() });

/**
 * Advances the scan queue by one batch.
 *
 * This is deliberately separate from /api/results. A provider call can take
 * thirty seconds; if the read endpoint waited for one, the dashboard would
 * block on every poll and the user would stare at an empty page. Reads stay
 * fast, and the client calls this in the background while it polls.
 *
 * On the free Vercel tier this is what actually moves the queue, since only
 * one scheduled job per day is permitted.
 */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const { workspaceId } = Body.parse(await req.json());
  await requireWorkspace(s, workspaceId);

  const [{ n: pending }] = await sql`
    select count(*)::int as n from scan_jobs j
      join scans sc on sc.id = j.scan_id
     where sc.workspace_id = ${workspaceId} and j.done_at is null and j.attempts < 4`;

  if (!pending) return Response.json({ pending: 0, drained: null });

  const drained = await drainJobs(20, 45_000);

  const [{ n: left }] = await sql`
    select count(*)::int as n from scan_jobs j
      join scans sc on sc.id = j.scan_id
     where sc.workspace_id = ${workspaceId} and j.done_at is null and j.attempts < 4`;

  return Response.json({ pending: left, drained });
});

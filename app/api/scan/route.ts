import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { limits } from '@/lib/plans';
import { enqueueScan, drainJobs } from '@/lib/scan';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  workspaceId: z.string().uuid(),
  /** Drain a few jobs immediately so the first result appears without waiting for cron. */
  warm: z.boolean().default(true),
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const { workspaceId, warm } = Body.parse(await req.json());
  await requireWorkspace(s, workspaceId);

  // One manual scan per hour per workspace: providers are metered, and a
  // refresh button is exactly the thing people click twenty times.
  const [recent] = await sql`
    select started_at from scans
     where workspace_id = ${workspaceId} and started_at > now() - interval '1 hour'
     order by started_at desc limit 1`;
  const [{ n: pending }] = await sql`
    select count(*)::int as n from scan_jobs j join scans sc on sc.id = j.scan_id
     where sc.workspace_id = ${workspaceId} and j.done_at is null`;
  if (recent && pending === 0) {
    throw new HttpError(429, 'A scan already ran within the last hour. The next one is scheduled automatically.');
  }

  const result = await enqueueScan(workspaceId, { runs: limits(s.plan).runs, force: true });
  if (result.skipped === 'no_engine_keys') {
    throw new HttpError(503, 'No AI provider keys are configured on the server yet.');
  }

  let drained = null;
  if (warm) drained = await drainJobs(24, 40_000);

  return Response.json({ ...result, drained });
});

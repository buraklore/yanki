import { drainJobs } from '@/lib/scan';
import { pruneRateLimits } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Runs every two minutes and drains a batch. Bounded by both batch size and
 * wall clock; whatever is left is picked up next time. On a VPS, worker.ts
 * calls the same function in a loop with a bigger batch.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const result = await drainJobs(20, 45_000);
  // Housekeeping rides along with a job that already runs every two minutes,
  // rather than earning its own cron entry.
  pruneRateLimits().catch(() => {});
  return Response.json(result);
}

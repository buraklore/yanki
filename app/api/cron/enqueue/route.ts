import { sql } from '@/lib/db';
import { enqueueScan, drainJobs } from '@/lib/scan';
import { limits, type PlanKey } from '@/lib/plans';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Vercel Cron sends the secret as a bearer token.
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Nightly: open today's scan for every workspace whose plan allows it. */
export async function GET(req: Request) {
  if (!authorised(req)) return new Response('unauthorized', { status: 401 });

  const workspaces = await sql`
    select w.id, o.plan from workspaces w
      join organizations o on o.id = w.org_id
     where w.onboarded
       and (o.plan <> 'trial' or o.trial_ends_at > now())`;

  const results: unknown[] = [];
  for (const w of workspaces) {
    if (!limits(w.plan as PlanKey).dailyScan) continue;
    try { results.push(await enqueueScan(w.id)); }
    catch (e) { results.push({ workspace: w.id, error: (e as Error).message }); }
  }
  // On the free tier this is the only scheduled run of the day, so it also
  // drains as much as it can inside the function's time budget. Whatever is
  // left is picked up by /api/results while someone has the dashboard open,
  // or by /api/cron/drain if a scheduler is calling it.
  let drained = null;
  try { drained = await drainJobs(30, 40_000); } catch { /* enqueue still succeeded */ }

  return Response.json({ considered: workspaces.length, queued: results.length, results, drained });
}

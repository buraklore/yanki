import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { buildDigest } from '@/lib/digest';

export const dynamic = 'force-dynamic';

/** What moved since the last scan, for the in-app "what changed" panel. */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') ?? '';
  await requireWorkspace(s, workspaceId);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 7)));

  const [digest, history] = await Promise.all([
    buildDigest(workspaceId, days),
    sql`select period_start, period_end, sent_at, summary
          from digests where workspace_id = ${workspaceId}
         order by period_start desc limit 8`,
  ]);
  return Response.json({ digest, history });
});

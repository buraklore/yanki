import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * recommendations — persistence for Action Center cards.
 *
 * The cards themselves are computed deterministically from data the panel
 * already holds (buildCenter in app.html); duplicating that derivation on the
 * server would give the same list a second author and let the two drift.
 * What the server owns is the part a re-render must not lose: which cards the
 * operator marked done or dismissed, and when.
 *
 * `ref` is the card's stable identity — e.g. `opp:<promptId>`,
 * `audit:<factorKey>`, `platform:<engineKey>:<diagnosis>` — so the same
 * finding maps to the same row across days and scans. `done_at` dates are the
 * before/after markers (§26): "what changed after this fix" is answered by
 * comparing daily_scores around that date.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const workspaceId = new URL(req.url).searchParams.get('workspace') ?? '';
  await requireWorkspace(s, workspaceId);

  const rows = await sql`
    select id, ref, kind, title, severity, status, created_at, done_at
      from recommendations
     where workspace_id = ${workspaceId}
     order by (status = 'open') desc, done_at desc nulls last, created_at desc
     limit 200`;
  return Response.json({ recommendations: rows });
});

const Upsert = z.object({
  workspaceId: z.string().uuid(),
  ref: z.string().min(3).max(200),
  kind: z.enum(['opportunity', 'audit', 'platform', 'source', 'perception', 'other']),
  title: z.string().min(3).max(300),
  severity: z.enum(['high', 'mid', 'low']).default('mid'),
  status: z.enum(['open', 'done', 'dismissed']).default('done'),
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Upsert.parse(await req.json());
  await requireWorkspace(s, b.workspaceId);

  const [row] = await sql`
    insert into recommendations (workspace_id, ref, kind, title, severity, status, done_at)
    values (${b.workspaceId}, ${b.ref}, ${b.kind}, ${b.title}, ${b.severity}, ${b.status},
            ${b.status === 'done' ? sql`now()` : null})
    on conflict (workspace_id, ref) do update
      set status = excluded.status,
          title = excluded.title,
          severity = excluded.severity,
          done_at = case when excluded.status = 'done'
                         then coalesce(recommendations.done_at, now())
                         else null end
    returning id, ref, kind, title, severity, status, created_at, done_at`;
  return Response.json({ recommendation: row });
});

const Patch = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'done', 'dismissed']),
});

export const PATCH = handler(async (req) => {
  const s = await requireSession();
  const b = Patch.parse(await req.json());

  const [row] = await sql`
    update recommendations r
       set status = ${b.status},
           done_at = case when ${b.status} = 'done'
                          then coalesce(r.done_at, now()) else null end
      from workspaces w
     where r.id = ${b.id} and w.id = r.workspace_id and w.org_id = ${s.orgId}
    returning r.id, r.ref, r.status, r.done_at`;
  if (!row) throw new HttpError(404, 'Not found');
  return Response.json({ recommendation: row });
});

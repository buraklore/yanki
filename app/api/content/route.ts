import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * content — history of what the generators produced (§18/§19).
 *
 * The generators themselves stay in the browser: they are deterministic
 * templates over workspace data, and moving them server-side would add a
 * round trip for no new information. What was missing was the record. A
 * customer who generated an llms.txt three weeks ago and now sees the bot
 * hits rising needs the date and the exact content to make that connection —
 * "did the fix ship, and what exactly was it" must survive the browser tab.
 *
 * Saves are fire-and-forget from the UI: a failed save never blocks the
 * download the user actually asked for.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const workspaceId = new URL(req.url).searchParams.get('workspace') ?? '';
  await requireWorkspace(s, workspaceId);

  const rows = await sql`
    select id, kind, title, created_at, length(body)::int as bytes
      from generated_content
     where workspace_id = ${workspaceId}
     order by created_at desc limit 50`;
  return Response.json({ items: rows });
});

const Save = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(['llms', 'robots', 'schema', 'meta', 'content']),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(120_000),
  promptId: z.string().uuid().nullable().optional(),
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Save.parse(await req.json());
  await requireWorkspace(s, b.workspaceId);

  const [row] = await sql`
    insert into generated_content (workspace_id, kind, title, body, prompt_id)
    values (${b.workspaceId}, ${b.kind}, ${b.title}, ${b.body}, ${b.promptId ?? null})
    returning id, kind, title, created_at`;
  return Response.json({ item: row });
});

/** One item with its body, for re-download from the history list. */
export const PUT = handler(async (req) => {
  const s = await requireSession();
  const b = z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() })
    .parse(await req.json());
  await requireWorkspace(s, b.workspaceId);

  const [row] = await sql`
    select id, kind, title, body, created_at from generated_content
     where id = ${b.id} and workspace_id = ${b.workspaceId}`;
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ item: row });
});

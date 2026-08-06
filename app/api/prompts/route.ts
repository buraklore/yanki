import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { limits, type PlanKey } from '@/lib/plans';

export const dynamic = 'force-dynamic';

const Add = z.object({
  workspaceId: z.string().uuid(),
  prompts: z.array(z.object({
    text: z.string().min(3).max(400),
    intent: z.enum(['transactional', 'brand_defence', 'comparison', 'evaluation', 'informational']),
    volume: z.number().int().min(1).max(1_000_000).default(200),
    source: z.enum(['ai', 'custom']).default('custom'),
  })).min(1).max(200),
});

export const GET = handler(async (req) => {
  const s = await requireSession();
  const id = new URL(req.url).searchParams.get('workspace');
  if (!id) throw new HttpError(400, 'workspace required');
  await requireWorkspace(s, id);
  const rows = await sql`
    select id, text, intent, volume, source, active from prompts
     where workspace_id = ${id} order by created_at`;
  return Response.json({ prompts: rows });
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Add.parse(await req.json());
  await requireWorkspace(s, b.workspaceId);

  const [{ n }] = await sql`
    select count(*)::int as n from prompts where workspace_id = ${b.workspaceId} and active`;
  const cap = limits(s.plan as PlanKey).prompts;
  const room = cap - n;
  if (room <= 0) throw new HttpError(402, `Your plan tracks up to ${cap} prompts.`);

  const rows = b.prompts.slice(0, room).map(p => ({
    workspace_id: b.workspaceId, text: p.text.trim(),
    intent: p.intent, volume: p.volume, source: p.source,
  }));
  const inserted = await sql`
    insert into prompts ${sql(rows)} on conflict (workspace_id, text) do nothing returning id`;

  return Response.json({ added: inserted.length, skipped: b.prompts.length - inserted.length });
});

const Patch = z.object({ id: z.string().uuid(), active: z.boolean() });

export const PATCH = handler(async (req) => {
  const s = await requireSession();
  const b = Patch.parse(await req.json());
  const [row] = await sql`
    update prompts p set active = ${b.active}
      from workspaces w
     where p.id = ${b.id} and w.id = p.workspace_id and w.org_id = ${s.orgId}
    returning p.id, p.active`;
  if (!row) throw new HttpError(404, 'Not found');
  return Response.json({ prompt: row });
});

export const DELETE = handler(async (req) => {
  const s = await requireSession();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'id required');
  const [row] = await sql`
    delete from prompts p using workspaces w
     where p.id = ${id} and w.id = p.workspace_id and w.org_id = ${s.orgId}
    returning p.id`;
  if (!row) throw new HttpError(404, 'Not found');
  return Response.json({ ok: true });
});

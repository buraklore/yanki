import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { limits, type PlanKey } from '@/lib/plans';
import { buildAliases } from '@/lib/entity';

export const dynamic = 'force-dynamic';

const Create = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  domain: z.string().max(200).nullable().optional(),
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Create.parse(await req.json());
  await requireWorkspace(s, b.workspaceId);

  const [{ n }] = await sql`
    select count(*)::int as n from competitors where workspace_id = ${b.workspaceId} and active`;
  const cap = limits(s.plan as PlanKey).competitors;
  if (n >= cap) throw new HttpError(402, `Your plan tracks up to ${cap} competitors.`);

  const name = b.name.trim();
  const domain = b.domain?.trim() || null;
  const [row] = await sql`
    insert into competitors (workspace_id, name, domain, aliases)
    values (${b.workspaceId}, ${name}, ${domain},
            ${buildAliases({ name, domain: domain ?? undefined }).filter(a => a !== name)})
    on conflict (workspace_id, name) do update set active = true, domain = excluded.domain
    returning *`;
  return Response.json({ competitor: row });
});

export const DELETE = handler(async (req) => {
  const s = await requireSession();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'id required');

  // Soft delete: historical run_brands rows stay intact so past scores remain
  // reproducible. Removing a competitor must not rewrite history.
  const [row] = await sql`
    update competitors c set active = false
      from workspaces w
     where c.id = ${id} and w.id = c.workspace_id and w.org_id = ${s.orgId}
    returning c.id`;
  if (!row) throw new HttpError(404, 'Not found');
  return Response.json({ ok: true });
});

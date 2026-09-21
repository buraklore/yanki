import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { limits, type PlanKey } from '@/lib/plans';
import { buildAliases } from '@/lib/entity';
import { backfillBrands } from '@/lib/scan';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * candidates — brands the judge saw in answers that we do not track yet.
 *
 * Discovery is passive and free: the mention judge already reads every answer,
 * and reporting the *other* brand names it saw costs a few extra output
 * tokens on a call we were making anyway. Nothing here touches scoring —
 * a candidate becomes part of the measurement only when the operator promotes
 * it, at which point it is an ordinary competitor with a full backfill.
 *
 * Status is a one-way door per name: 'dismissed' is remembered, so a brand
 * the operator rejected does not resurface on the next scan. Counters still
 * accumulate underneath, which lets the UI say "dismissed, but seen 40 times
 * since" if we ever want to.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const workspaceId = new URL(req.url).searchParams.get('workspace') ?? '';
  await requireWorkspace(s, workspaceId);

  const rows = await sql`
    select cb.id, cb.name, cb.mentions, cb.first_seen, cb.last_seen, cb.status,
           p.text as sample_prompt
      from candidate_brands cb
 left join prompts p on p.id = cb.sample_prompt_id
     where cb.workspace_id = ${workspaceId} and cb.status = 'pending'
     order by cb.mentions desc, cb.last_seen desc
     limit 30`;
  return Response.json({ candidates: rows });
});

const Act = z.object({
  workspaceId: z.string().uuid(),
  id: z.string().uuid(),
  action: z.enum(['add', 'dismiss']),
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const b = Act.parse(await req.json());
  await requireWorkspace(s, b.workspaceId);

  const [cand] = await sql`
    select id, name from candidate_brands
     where id = ${b.id} and workspace_id = ${b.workspaceId}`;
  if (!cand) throw new HttpError(404, 'Not found');

  if (b.action === 'dismiss') {
    await sql`update candidate_brands set status = 'dismissed' where id = ${b.id}`;
    return Response.json({ ok: true });
  }

  // Promote: same cap and same alias derivation as a manually added rival.
  const [{ n }] = await sql`
    select count(*)::int as n from competitors
     where workspace_id = ${b.workspaceId} and active`;
  const cap = limits(s.plan as PlanKey).competitors;
  if (n >= cap) throw new HttpError(402, `Your plan tracks up to ${cap} competitors.`);

  const name = String(cand.name).trim();
  const [row] = await sql`
    insert into competitors (workspace_id, name, aliases)
    values (${b.workspaceId}, ${name},
            ${buildAliases({ name }).filter(a => a !== name)})
    on conflict (workspace_id, name) do update set active = true
    returning *`;
  await sql`update candidate_brands set status = 'added' where id = ${b.id}`;

  // The answers that surfaced this candidate are already on disk; match the
  // new competitor against them so its numbers are real from the first render.
  let backfill = null;
  try { backfill = await backfillBrands(b.workspaceId, { days: 90 }); }
  catch { /* saved either way; the next scan fills it */ }

  return Response.json({ competitor: row, backfill });
});

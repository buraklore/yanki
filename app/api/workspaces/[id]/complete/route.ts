import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { limits } from '@/lib/plans';
import { buildAliases } from '@/lib/entity';
import { enqueueScan } from '@/lib/scan';

export const dynamic = 'force-dynamic';

const Body = z.object({
  competitors: z.array(z.object({
    name: z.string().min(1).max(120),
    domain: z.string().max(200).optional().nullable(),
  })).max(60).default([]),
  prompts: z.array(z.object({
    text: z.string().min(3).max(400),
    intent: z.enum(['transactional', 'brand_defence', 'comparison', 'evaluation', 'informational']),
    volume: z.number().int().min(1).max(1_000_000).default(100),
    source: z.enum(['ai', 'custom']).default('ai'),
  })).min(1).max(600),
});

/**
 * Final onboarding step. Writes competitors and prompts, marks the workspace
 * onboarded and queues the first scan — all in one transaction, so a failure
 * halfway cannot leave a workspace that looks ready but has no prompts.
 */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const id = new URL(req.url).pathname.split('/').slice(-2)[0];
  const ws = await requireWorkspace(s, id);
  const b = Body.parse(await req.json());
  const cap = limits(s.plan);

  if (b.prompts.length > cap.prompts) {
    throw new HttpError(402, `Your plan tracks up to ${cap.prompts} prompts. Deselect a few and try again.`);
  }
  const competitors = b.competitors.filter(c => c.name.trim()).slice(0, cap.competitors);

  await sql.begin(async (tx: typeof sql) => {
    if (competitors.length) {
      await tx`insert into competitors ${tx(competitors.map(c => ({
        workspace_id: id,
        name: c.name.trim(),
        domain: c.domain?.trim() || null,
        aliases: buildAliases({ name: c.name.trim(), domain: c.domain || undefined })
          .filter(a => a !== c.name.trim()),
      })))} on conflict (workspace_id, name) do nothing`;
    }
    await tx`insert into prompts ${tx(b.prompts.map(p => ({
      workspace_id: id,
      text: p.text.trim(),
      intent: p.intent,
      volume: p.volume,
      source: p.source,
    })))} on conflict (workspace_id, text) do nothing`;
    await tx`update workspaces set onboarded = true where id = ${id}`;
  });

  const scan = await enqueueScan(id, { runs: cap.runs });
  return Response.json({ ok: true, workspace: ws.id, ...scan });
});

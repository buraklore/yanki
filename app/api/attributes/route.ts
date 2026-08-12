import { z } from 'zod';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { enforce } from '@/lib/rate-limit';
import { extractAttributes, attributeMatrix, attributeCoverage } from '@/lib/attributes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The attribute × brand matrix, plus how far the extraction pass has got. */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') ?? '';
  await requireWorkspace(s, workspaceId);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days') ?? 30)));

  const [matrix, coverage] = await Promise.all([
    attributeMatrix(workspaceId, days),
    attributeCoverage(workspaceId),
  ]);
  return Response.json({ matrix, coverage });
});

const Body = z.object({ workspaceId: z.string().uuid() });

/**
 * Runs a batch of the extraction pass. The client calls this while the panel
 * is open, the same way it drains the scan queue — the free Vercel tier gives
 * us one scheduled job a day, which is not enough on its own.
 */
export const POST = handler(async (req) => {
  const s = await requireSession();
  const { workspaceId } = Body.parse(await req.json());
  await requireWorkspace(s, workspaceId);
  // Each batch is up to 20 model calls. The screen pulls automatically while
  // the operator reads, so an unmetered endpoint here bills on its own.
  await enforce('attributes', s.orgId);
  return Response.json(await extractAttributes(workspaceId, { limit: 20, budgetMs: 45_000 }));
});

import { sql } from '@/lib/db';
import { requireSession, handler, HttpError } from '@/lib/auth';
import { buildAliases, findMentions } from '@/lib/entity';

export const dynamic = 'force-dynamic';

/**
 * The raw answer inspector. This is why a customer can trust a score: open any
 * cell and read the exact text the model returned, with the brands highlighted
 * and the model version and collection method attached.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const id = Number(new URL(req.url).searchParams.get('run'));
  if (!Number.isFinite(id)) throw new HttpError(400, 'run id required');

  const [run] = await sql`
    select ar.*, p.text as prompt_text, p.intent,
           w.org_id, w.brand_name, w.domain, w.aliases
      from answer_runs ar
      join prompts p on p.id = ar.prompt_id
      join workspaces w on w.id = ar.workspace_id
     where ar.id = ${id}`;
  if (!run || run.org_id !== s.orgId) throw new HttpError(404, 'Not found');

  const rivals = await sql`
    select c.id, c.name, c.domain, c.aliases, rb.rank
      from run_brands rb join competitors c on c.id = rb.competitor_id
     where rb.run_id = ${id} order by rb.rank`;

  const citations = await sql`select domain from run_citations where run_id = ${id}`;

  // Highlight offsets are computed server-side from the same matcher that
  // produced the score, so what the user sees is exactly what was counted.
  const spans: { start: number; end: number; brand: string; self: boolean }[] = [];
  const push = (aliases: string[], name: string, self: boolean) => {
    for (const m of findMentions(run.answer_text ?? '', aliases)) {
      spans.push({ start: m.index, end: m.index + m.surface.length, brand: name, self });
    }
  };
  push(buildAliases({ name: run.brand_name, domain: run.domain, variants: run.aliases }), run.brand_name, true);
  for (const r of rivals) {
    push(buildAliases({ name: r.name, domain: r.domain, variants: r.aliases }), r.name, false);
  }
  spans.sort((a, b) => a.start - b.start);

  return Response.json({
    prompt: run.prompt_text,
    intent: run.intent,
    engine: run.engine_key,
    modelVersion: run.model_version,
    method: run.method,
    askedAt: run.asked_at,
    runIndex: run.run_index,
    answer: run.answer_text,
    spans,
    mentioned: run.mentioned,
    rank: run.rank,
    cited: run.cited,
    recommendation: run.recommendation,
    sentiment: run.sentiment === null ? null : Number(run.sentiment),
    degraded: run.degraded,
    competitors: rivals.map((r: { name: string; rank: number }) => ({ name: r.name, rank: r.rank })),
    citations: citations.map((c: { domain: string }) => c.domain),
  });
});

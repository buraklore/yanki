import { z } from 'zod';
import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler, HttpError } from '@/lib/auth';
import { enforce } from '@/lib/rate-limit';
import { classifyDomains, normalizeDomain, SOURCE_KINDS, type SourceKind } from '@/lib/source-kind';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Kaynak alan adı sınıflandırması — arka plan çözümü ve kullanıcı düzeltmesi.
 *
 * /api/results sınıflandırmayı `allowLlm: false` ile çağırır: panel isteği
 * hiçbir zaman bir model yanıtını beklemez. Çözülemeyen alan adları 'unknown'
 * döner ve bu uç onları arka planda çözer.
 *
 * POST  → bekleyen alan adlarını modele sorar, ortak tabloya yazar
 * PATCH → kullanıcının elle işaretlediği türü kaydeder
 */

const Resolve = z.object({ workspaceId: z.string().uuid() });

export const POST = handler(async (req) => {
  const s = await requireSession();
  const { workspaceId } = Resolve.parse(await req.json());
  const ws = await requireWorkspace(s, workspaceId);

  /* Model çağrısı yapan her uç gibi ölçülü. Bir parti en fazla 20 alan adı ve
   * her biri için bir sayfa çekme; sınırsız bırakmak sağlayıcı faturasını
   * kullanıcının sabırsızlığına bağlar. */
  await enforce('sourceClassify', s.orgId);

  // Bu markanın kaynakları arasında henüz sınıfı bilinmeyenler.
  const rows = await sql<{ domain: string }[]>`
    select distinct rc.domain
      from run_citations rc
      join answer_runs ar on ar.id = rc.run_id
     where ar.workspace_id = ${workspaceId}
       and ar.asked_at > now() - interval '30 days'
       and not exists (
         select 1 from source_domains sd
          where sd.domain = rc.domain and sd.kind <> 'unknown')
     limit 40`;

  if (!rows.length) return Response.json({ pending: 0, classified: 0 });

  const rivals = await sql<{ domain: string | null }[]>`
    select domain from competitors where workspace_id = ${workspaceId} and active`;

  const ownHost = ws.domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const kinds = await classifyDomains(rows.map(r => r.domain), {
    rivalDomains: rivals.map(r => r.domain).filter((d): d is string => !!d),
    ownDomain: ownHost,
    allowLlm: true,
  });

  let resolved = 0;
  for (const k of kinds.values()) if (k.kind !== 'unknown') resolved++;

  return Response.json({
    pending: rows.length,
    classified: resolved,
    stillUnknown: rows.length - resolved,
  });
});

const Correct = z.object({
  domain: z.string().min(3).max(253),
  kind: z.enum(SOURCE_KINDS as unknown as [SourceKind, ...SourceKind[]]),
});

/**
 * Kullanıcı düzeltmesi.
 *
 * Ortak tabloya doğrudan yazılır: bir müşterinin düzeltmesi tüm müşterilere
 * fayda sağlar, ve elle küratörlük beklemek corpus'u büyütmez. method='user'
 * kaydı, lib/source-kind.ts içindeki model güncellemesi tarafından ezilmez —
 * insan kararı modelin üzerindedir.
 */
export const PATCH = handler(async (req) => {
  const s = await requireSession();
  const body = Correct.parse(await req.json());
  const domain = normalizeDomain(body.domain);
  if (!domain || !domain.includes('.')) {
    throw new HttpError(400, 'Geçerli bir alan adı gerekiyor.');
  }
  // Kötüye kullanım için düşük tavan: bu bir veri girişi aracı değil.
  await enforce('sourceCorrect', s.orgId);

  await sql`
    insert into source_domains (domain, kind, confidence, method, evidence)
    values (${domain}, ${body.kind}, 1.0, 'user',
            ${JSON.stringify({ note: 'Kullanıcı tarafından işaretlendi', orgId: s.orgId })}::jsonb)
    on conflict (domain) do update
      set kind = excluded.kind, confidence = 1.0, method = 'user',
          evidence = excluded.evidence, updated_at = now()
      -- Elle küratörlük yapılmış kayıt korunur; kullanıcı yalnızca model
      -- kararını veya boşluğu düzeltebilir.
      where source_domains.method <> 'manual'`;

  return Response.json({ domain, kind: body.kind });
});

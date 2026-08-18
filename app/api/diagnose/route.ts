import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { classifyDomains, PLAYBOOKS, type SourceKind } from '@/lib/source-kind';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * diagnose — tek bir sorgu için "neden geçmiyorum, nasıl geçerim".
 *
 * Ürün bugüne kadar üç bilgiyi ayrı ekranlarda gösteriyordu: bu sorguda
 * geçmiyorsunuz (Fırsatlar), bu cevapta şu siteler kaynak gösterilmiş
 * (ham cevap), sitenizde şu kriterler eksik (Denetim). Bağlantıyı kullanıcı
 * kuruyordu.
 *
 * Burada üçü birleştiriliyor. Yeni ölçüm yok — hepsi zaten toplanmış veri.
 *
 * Tasarım kuralı: hiçbir cümle ölçülmemiş bir şey iddia etmez. "Sayfanız zayıf"
 * demiyoruz, "bu sorguda kaynak gösterilen beş sitede yoksunuz" diyoruz —
 * ikincisi ölçüm, birincisi tahmin.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') ?? '';
  const promptId = url.searchParams.get('prompt') ?? '';
  const ws = await requireWorkspace(s, workspaceId);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days') ?? 30)));

  const [[prompt], runs, citations, brands, auditRows, rivalRows] = await Promise.all([
    sql`select id, text, intent, volume from prompts
         where id = ${promptId} and workspace_id = ${workspaceId}`,

    /* Bu sorgunun her platformdaki sonucu. mentioned/rank koşu başına;
     * platform başına özetliyoruz çünkü kullanıcı "hangi platformda yokum"
     * sorusunu soruyor, "hangi koşuda" değil. */
    sql`select ar.engine_key,
               count(*)::int                                    as runs,
               count(*) filter (where ar.mentioned)::int        as mentions,
               round(avg(ar.rank) filter (where ar.mentioned), 1) as avg_rank,
               bool_or(ar.cited)                                as cited
          from answer_runs ar
         where ar.workspace_id = ${workspaceId}
           and ar.prompt_id = ${promptId}
           and ar.asked_at > now() - make_interval(days => ${days})
         group by 1 order by mentions desc, runs desc`,

    // Bu sorgunun cevaplarında kaynak gösterilen siteler.
    sql`select rc.domain, count(*)::int as n
          from run_citations rc
          join answer_runs ar on ar.id = rc.run_id
         where ar.workspace_id = ${workspaceId}
           and ar.prompt_id = ${promptId}
           and ar.asked_at > now() - make_interval(days => ${days})
         group by 1 order by n desc limit 12`,

    // Bu sorguda hangi marka kaç cevapta geçti.
    sql`select coalesce(c.name, '') as name, rb.is_self,
               count(*)::int as n,
               round(avg(rb.rank), 1) as avg_rank
          from run_brands rb
          join answer_runs ar on ar.id = rb.run_id
     left join competitors c on c.id = rb.competitor_id
         where ar.workspace_id = ${workspaceId}
           and ar.prompt_id = ${promptId}
           and ar.asked_at > now() - make_interval(days => ${days})
         group by 1, 2 order by n desc limit 8`,

    /* Denetimden yalnızca BU sorguyla ilgili kriterler.
     * Tüm 58 kriteri listelemek teşhis değil, gürültü olur — sorgu bazlı
     * görünürlüğü doğrudan etkileyen üç aile seçiliyor. */
    sql`select f.factor_key, f.label, f.category, f.status
          from audit_factors f
          join audits a on a.id = f.audit_id
         where a.workspace_id = ${workspaceId}
           and f.status in ('fail','partial')
           -- Kategoriler veritabanında İngilizce saklanır; çeviri arayüzde
           -- yapılır. Sorgu bazlı görünürlüğü doğrudan etkileyen üç aile.
           and f.category in ('Answer-ready content structure','Structured data',
                              'Accessibility and rendering')
         order by a.ran_at desc, f.status limit 6`,

    sql`select domain from competitors where workspace_id = ${workspaceId} and active`,
  ]);

  if (!prompt) return Response.json({ error: 'Sorgu bulunamadı.' }, { status: 404 });

  const ownHost = ws.domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const cit = citations as unknown as { domain: string; n: number }[];

  const kinds = await classifyDomains(cit.map(c => c.domain), {
    rivalDomains: (rivalRows as unknown as { domain: string | null }[])
      .map(r => r.domain).filter((d): d is string => !!d),
    ownDomain: ownHost,
    allowLlm: false,
  });

  const kaynaklar = cit.map(c => {
    const k = kinds.get(c.domain);
    const kind = (k?.kind ?? 'unknown') as SourceKind;
    return {
      domain: c.domain,
      citations: c.n,
      kind,
      label: PLAYBOOKS[kind].label,
      reachable: PLAYBOOKS[kind].reachable,
      eta: PLAYBOOKS[kind].eta,
      mine: c.domain === ownHost,
    };
  });

  const plat = runs as unknown as {
    engine_key: string; runs: number; mentions: number; avg_rank: number | null; cited: boolean;
  }[];
  const gecmedigi = plat.filter(p => p.mentions === 0);
  const gectigi   = plat.filter(p => p.mentions > 0);

  const markalar = (brands as unknown as {
    name: string; is_self: boolean; n: number; avg_rank: number | null;
  }[]).map(b => ({
    name: b.is_self ? null : b.name,
    isSelf: b.is_self === true,
    answers: b.n,
    avgRank: b.avg_rank === null ? null : Number(b.avg_rank),
  }));

  const kendiSitem = kaynaklar.some(k => k.mine);
  const girilebilir = kaynaklar.filter(k => !k.mine && k.reachable);
  const girilemez  = kaynaklar.filter(k => !k.mine && !k.reachable && k.kind !== 'unknown');

  return Response.json({
    prompt: { id: prompt.id, text: prompt.text, intent: prompt.intent, volume: prompt.volume },
    days,
    platforms: plat.map(p => ({
      engineKey: p.engine_key,
      runs: p.runs,
      mentions: p.mentions,
      coverage: p.runs ? p.mentions / p.runs : 0,
      avgRank: p.avg_rank === null ? null : Number(p.avg_rank),
      cited: p.cited === true,
    })),
    absentOn: gecmedigi.length,
    presentOn: gectigi.length,
    /** Ölçülmüş sebepler. Her biri bir sayıya dayanıyor; yorum değil. */
    reasons: [
      ...(kaynaklar.length && !kendiSitem ? [{
        kind: 'not_in_sources',
        n: kaynaklar.filter(k => !k.mine).length,
      }] : []),
      ...(markalar.some(m => !m.isSelf) ? [{
        kind: 'rival_present',
        n: markalar.filter(m => !m.isSelf).length,
      }] : []),
      ...((auditRows as unknown as unknown[]).length ? [{
        kind: 'audit_gaps',
        n: (auditRows as unknown as unknown[]).length,
      }] : []),
      ...(!kaynaklar.length ? [{ kind: 'no_citations', n: 0 }] : []),
    ],
    sources: kaynaklar,
    brands: markalar,
    auditGaps: (auditRows as unknown as {
      factor_key: string; label: string; category: string; status: string;
    }[]).map(f => ({ key: f.factor_key, label: f.label, category: f.category, status: f.status })),
    /** Sırayla yapılacaklar. Kaynak sınıfı ne yapılacağını belirliyor. */
    fixes: {
      reachable: girilebilir.slice(0, 4),
      blocked: girilemez.length,
      ownContent: !kendiSitem,
      auditCount: (auditRows as unknown as unknown[]).length,
    },
  });
});

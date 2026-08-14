import { sql } from '@/lib/db';
import { requireSession, requireWorkspace, handler } from '@/lib/auth';
import { attributeMatrix } from '@/lib/attributes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * perception — markanız hakkında ne söyleniyor, nasıl bir tonla?
 *
 * Görünürlük skoru "kaç kez geçtiniz" sorusunu ölçer. Bu ekran farklı bir soruyu
 * ölçer: geçtiğiniz yerlerde ne deniyor. İkisi bağımsız olabilir — her cevapta
 * geçip her cevapta olumsuz anılmak mümkündür, ve bu durumda yüksek görünürlük
 * skoru zarar veriyordur.
 *
 * Hiçbir yeni ölçüm yapılmıyor: ton (answer_runs.sentiment), sıfatlar
 * (run_attributes) ve marka geçişleri (run_brands) zaten her taramada toplanıyor.
 * Eksik olan şey ekrandı.
 */
export const GET = handler(async (req) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace') ?? '';
  await requireWorkspace(s, workspaceId);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get('days') ?? 30)));

  const [trend, byEngine, overall, samples, matrix, rivals] = await Promise.all([
    /* Günlük olumlu/nötr/olumsuz dağılımı.
     * Yalnızca markanın anıldığı koşular sayılır: anılmayan bir cevabın tonu
     * yoktur ve onu nötr saymak, dağılımı sessizce nötre doğru çeker. */
    sql`select ar.asked_at::date as day,
               count(*) filter (where ar.sentiment >=  0.25)::int as pos,
               count(*) filter (where ar.sentiment >  -0.25
                                  and ar.sentiment <   0.25)::int as neu,
               count(*) filter (where ar.sentiment <= -0.25)::int as neg
          from answer_runs ar
         where ar.workspace_id = ${workspaceId}
           and ar.mentioned
           and ar.sentiment is not null
           and ar.asked_at > now() - make_interval(days => ${days})
         group by 1 order by 1`,

    // Platform kırılımı. Sağlayıcılar farklı ayrıntı düzeyinde cevap verir, bu
    // yüzden oranlar sağlayıcılar arasında değil, aynı sağlayıcı içinde zamanla
    // karşılaştırılmalı — arayüz bunu yazıyor.
    sql`select ar.engine_key,
               count(*)::int as mentions,
               round(avg(ar.sentiment)::numeric, 3) as avg_sentiment,
               count(*) filter (where ar.sentiment >= 0.25)::int as pos
          from answer_runs ar
         where ar.workspace_id = ${workspaceId}
           and ar.mentioned and ar.sentiment is not null
           and ar.asked_at > now() - make_interval(days => ${days})
         group by 1 order by mentions desc`,

    sql`select count(*)::int as n,
               count(*) filter (where ar.sentiment >=  0.25)::int as pos,
               count(*) filter (where ar.sentiment >  -0.25
                                  and ar.sentiment <   0.25)::int as neu,
               count(*) filter (where ar.sentiment <= -0.25)::int as neg,
               round(avg(ar.sentiment)::numeric, 3) as avg_sentiment
          from answer_runs ar
         where ar.workspace_id = ${workspaceId}
           and ar.mentioned and ar.sentiment is not null
           and ar.asked_at > now() - make_interval(days => ${days})`,

    /* Örnek geçişler.
     * Cevabın tamamı değil, markanın adının geçtiği cümle. Bir marka yöneticisi
     * "AI benim hakkımda ne diyor" sorusunun cevabını okumak ister; 800 kelimelik
     * cevabı taramak zorunda kalmamalı. En olumsuz ve en olumlu uçlar önce gelir
     * çünkü karar gerektiren yer orası. */
    sql`select ar.id, ar.engine_key, ar.sentiment, ar.rank, ar.recommendation,
               ar.answer_text, ar.asked_at, p.text as prompt
          from answer_runs ar
          join prompts p on p.id = ar.prompt_id
         where ar.workspace_id = ${workspaceId}
           and ar.mentioned and ar.answer_text is not null
           and ar.asked_at > now() - make_interval(days => ${days})
         order by abs(coalesce(ar.sentiment, 0)) desc, ar.asked_at desc
         limit 40`,

    attributeMatrix(workspaceId, days),

    /* Rakip algı kıyası: aynı pencerede, aynı sorgularda, rakip adı geçen
     * cevapların tonu. run_brands marka geçişlerini koşuya bağlıyor, bu yüzden
     * "bu cevabın tonu" rakip için de okunabilir. */
    sql`select coalesce(c.name, '(siz)') as name,
               (rb.is_self) as is_self,
               count(*)::int as mentions,
               round(avg(ar.sentiment)::numeric, 3) as avg_sentiment,
               count(*) filter (where ar.sentiment >= 0.25)::int as pos
          from run_brands rb
          join answer_runs ar on ar.id = rb.run_id
     left join competitors c on c.id = rb.competitor_id
         where ar.workspace_id = ${workspaceId}
           and ar.sentiment is not null
           and ar.asked_at > now() - make_interval(days => ${days})
         group by 1, 2
        having count(*) >= 2
         order by mentions desc limit 12`,
  ]);

  const o = (overall as unknown as Record<string, unknown>[])[0] ?? {};
  const n = Number(o.n ?? 0);

  return Response.json({
    days,
    /** Ölçüm azken grafiği kesin gibi sunmak yanlış; arayüz bunu uyarı olarak gösterir. */
    thin: n < 12,
    overall: {
      mentions: n,
      pos: Number(o.pos ?? 0),
      neu: Number(o.neu ?? 0),
      neg: Number(o.neg ?? 0),
      avg: o.avg_sentiment === null || o.avg_sentiment === undefined
        ? null : Number(o.avg_sentiment),
    },
    trend: (trend as unknown as Record<string, unknown>[]).map(r => ({
      day: r.day, pos: Number(r.pos), neu: Number(r.neu), neg: Number(r.neg),
    })),
    byEngine: (byEngine as unknown as Record<string, unknown>[]).map(r => ({
      engineKey: r.engine_key,
      mentions: Number(r.mentions),
      avg: r.avg_sentiment === null ? null : Number(r.avg_sentiment),
      posPct: Number(r.mentions) ? Number(r.pos) / Number(r.mentions) * 100 : 0,
    })),
    /** Sıfatlar, markanın kendisine atfedilenler öne alınarak. */
    attributes: matrix
      .filter(a => a.brands.self?.n)
      .map(a => ({
        label: a.label,
        n: a.brands.self.n,
        polarity: a.brands.self.polarity,
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 24),
    rivals: (rivals as unknown as Record<string, unknown>[]).map(r => ({
      name: r.is_self ? null : String(r.name),
      isSelf: r.is_self === true,
      mentions: Number(r.mentions),
      avg: r.avg_sentiment === null ? null : Number(r.avg_sentiment),
      posPct: Number(r.mentions) ? Number(r.pos) / Number(r.mentions) * 100 : 0,
    })),
    samples: (samples as unknown as Record<string, unknown>[])
      .map(r => ({
        runId: Number(r.id),
        engineKey: r.engine_key,
        prompt: String(r.prompt),
        sentiment: r.sentiment === null ? null : Number(r.sentiment),
        rank: r.rank === null ? null : Number(r.rank),
        recommendation: r.recommendation,
        askedAt: r.asked_at,
        snippet: snippet(String(r.answer_text ?? '')),
      }))
      .filter(x => x.snippet)
      .slice(0, 12),
  });
});

/**
 * Cevabın okunabilir bir parçası.
 *
 * Tam metin modalda zaten var; buradaki amaç göz gezdirmek. İlk anlamlı cümleyi
 * alıyoruz — cevaplar neredeyse her zaman özetle başlar, bu yüzden ilk cümle
 * ortadan seçilmiş rastgele bir cümleden daha temsilidir.
 */
function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length < 30) return '';
  const first = flat.split(/(?<=[.!?])\s+/).find(s => s.length > 40) ?? flat;
  return first.slice(0, 260);
}

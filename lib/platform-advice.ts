import { sql } from './db';
import { classifyDomains, type SourceKind } from './source-kind';

/**
 * platform-advice.ts — why you are weak on *this* platform, and what to do.
 *
 * A single ranked to-do list quietly assumes every engine works the same way.
 * They do not, and the differences change the advice completely:
 *
 *   ChatGPT          blends pre-trained knowledge with live search; brand
 *                    mentions across the open web matter more than your own
 *                    pages, and being absent is usually an authority problem.
 *   Google AI Overviews  is fed by the Google index, so classic SEO still
 *                    applies — if you do not rank, you cannot be summarised.
 *   Gemini           same index, but leans harder on structured data and
 *                    entity resolution.
 *   Perplexity       retrieval-first and recency-biased; it cites what it just
 *                    fetched, so freshness and citability dominate.
 *   Claude           conservative about naming brands and prefers sources it
 *                    can attribute; quotable, well-attributed pages win.
 *   Grok / DeepSeek  thinner retrieval, heavier reliance on what the model
 *                    already absorbed — third-party presence is nearly all of it.
 *
 * Everything below is derived from data we already collected per engine: the
 * mention rate, the citation rate, the average rank, and which domains that
 * engine cited. No extra provider calls.
 */

export type Diagnosis =
  | 'not_measured'
  | 'absent'          // barely mentioned at all
  | 'mentioned_uncited'   // named, but our domain is never the source
  | 'low_rank'        // named, but always last
  | 'losing_to_rival' // a specific rival dominates here
  | 'healthy';

export interface PlatformAction {
  title: string;
  detail: string;
  steps: string[];
}

export interface PlatformAdvice {
  engineKey: string;
  engineLabel: string;
  weight: number;
  measured: boolean;
  score: number;
  mentionRate: number;
  citationRate: number;
  meanRank: number | null;
  checks: number;
  diagnosis: Diagnosis;
  /** Plain-language summary of what the numbers mean on this engine. */
  headline: string;
  why: string;
  actions: PlatformAction[];
  /** Domains this engine cited most, and whether we are among them. */
  topSources: { domain: string; count: number; ours: boolean }[];
  rival?: { name: string; mentions: number };
  /** Share of the total score this engine carries. */
  impact: number;
}

/* ------------------------------------------------------------------ */
/* Playbooks                                                           */
/* ------------------------------------------------------------------ */

type Playbook = Record<Diagnosis, (ctx: Ctx) => { headline: string; why: string; actions: PlatformAction[] }>;

interface Ctx {
  brand: string;
  host: string;
  label: string;
  /** `kind` ile birlikte: bir kaynağa nasıl girileceği türüne göre değişir. */
  topSources: { domain: string; count: number; ours: boolean; kind: SourceKind }[];
  rival?: { name: string; mentions: number };
  mentionRate: number;
  citationRate: number;
  meanRank: number | null;
}

/**
 * Kaynak adları — ama yalnızca GİRİLEBİLİR olanlar.
 *
 * Eskiden bu yardımcı en çok atıf alan iki alan adını döndürüyordu ve tavsiye
 * "şunların editörlerine ulaşın" diyordu. Gerçek müşteri verisinde kaynakların
 * %40'ı girilemez sınıfta: rakip ajans siteleri ve satıcı blogları. semrush.com
 * bir SaaS şirketinin kendi blogudur — editörüne yazıp listeye girilmez.
 *
 * Artık ulaşılabilir kaynaklar önce gelir; hiç yoksa çağıran taraf tavsiyeyi
 * kaynak adı üzerinden kurmaz.
 */
const reachableSrc = (c: Ctx, n = 2) =>
  c.topSources
    .filter(s => !s.ours && REACHABLE_KINDS.has(s.kind))
    .slice(0, n)
    .map(s => s.domain);

/** Girilemeyen kaynaklar: neden çalışılamadığını açıklamak için. */
const blockedSrc = (c: Ctx, n = 3) =>
  c.topSources
    .filter(s => !s.ours && !REACHABLE_KINDS.has(s.kind))
    .slice(0, n)
    .map(s => s.domain);

/**
 * Sadece durumu anlatan yerler için: en çok atıf alan kaynaklar, türü ne olursa
 * olsun. "Trafiğin gittiği yer orası" bir tespittir; oraya girilip girilemediği
 * o cümlenin doğruluğunu değiştirmez.
 */
const anySrc = (c: Ctx, n = 2) =>
  c.topSources.filter(s => !s.ours).slice(0, n).map(s => s.domain);

const REACHABLE_KINDS = new Set<SourceKind>([
  'directory', 'marketplace', 'review', 'publication',
  'community', 'self_publish', 'authority',
]);

const listOr = (arr: string[], fallback: string) => arr.length ? arr.join(', ') : fallback;

/** Advice shared by every engine, specialised below. */
/** Test edilebilir olması için dışa aktarıldı; davranış aynı. */
export const generic: Playbook = {
  not_measured: () => ({
    headline: 'Bu platform ölçülmedi',
    why: 'Anahtar tanımlı değil ya da planınızın üstünde. Buradaki boşluk bir skor değil, eksik bir ölçüm.',
    actions: [],
  }),
  healthy: c => ({
    headline: 'Bu platformda güçlüsünüz',
    why: `Sorguların çoğunda anılıyorsunuz ve ${c.host} kaynak olarak gösteriliyor. Buradaki iş korumak.`,
    actions: [{
      title: 'Kazandığınız sayfaları güncel tutun',
      detail: 'Bu platformda size atıf veren sayfalar bayatlarsa öncelik kaybedersiniz.',
      steps: [
        'Atıf alan sayfalarda dateModified alanını gerçek güncelleme tarihiyle işaretleyin',
        'Üç ayda bir sayı ve fiyat gibi somut verileri tazeleyin',
        'Skor düşerse haftalık özet e-postasında görürsünüz',
      ],
    }],
  }),
  absent: c => {
    /* Girilebilir kaynak var mı? Varsa adıyla söylenir ve o kaynağın türüne
     * uygun adım verilir. Yoksa kaynak adı üzerinden tavsiye kurulmaz —
     * "semrush.com üzerinde varlık kurun" diye bir iş yoktur. */
    const acik = reachableSrc(c, 2);
    const kapali = blockedSrc(c, 3);
    return {
      headline: 'Bu platformda neredeyse hiç geçmiyorsunuz',
      why: `${c.label} sizi tanımıyor. Kendi sitenizdeki içerik bunu tek başına çözmez; model markayı üçüncü taraf kaynaklardan öğrenir.`,
      actions: acik.length
        ? [{
            title: `${acik.length} kaynağa girmeniz mümkün — oradan başlayın`,
            detail: 'Bu platformun okuduğu kaynaklar arasında dışarıya açık olanlar bunlar. Giriş koşulu kaynağa göre değişir: kimi serbest kayıt, kimi başvuru veya iş ortaklığı ister.',
            steps: [
              /* Kaynağa özgü ayrıntı uydurulmuyor.
               *
               * Önceki sürüm "hizmet, sektör ve konum alanlarını doldurun",
               * "örnek olay ekleyin", "platform üzerinden değerlendirme
               * isteyin" diyordu — hiçbirini bilemeyiz. clutch.co'da örnek
               * olay ve yorum var; bir üreticinin iş ortağı ağında ikisi de
               * yok, üstelik kayıt değil ticari anlaşma gerekiyor. Bu, ilk
               * düzelttiğimiz "editörlerine ulaşın" hatasının aynısıydı:
               * kaynağın ne olduğunu bilmeden nasıl girileceğini söylemek. */
              'Kaynağı açın ve kendi giriş koşulunu okuyun — bir kısmı serbest kayıt, bir kısmı başvuru veya iş ortaklığı ister',
              'Kayıt serbestse profili eksiksiz doldurun; boş alan bırakılan kayıt listelerde arkaya düşer',
              'Başvuru veya iş ortaklığı isteniyorsa şartlarını ve maliyetini değerlendirin — her kaynak her markaya değmez',
              'Girdikten sonra bilgilerinizi sitenizdekiyle birebir aynı tutun; çelişen bilgi modelin markayı tanımasını zorlaştırır',
              ...(kapali.length
                ? [`Kalan ${kapali.length} kaynak bir şirketin kendi sitesidir — oraya dışarıdan girilmez, listede altta işaretli`]
                : []),
            ],
          }]
        : [{
            title: 'Girilebilir kaynak listesi oluşturun',
            detail: kapali.length
              ? `Bu platformun en çok okuduğu ${kapali.length} kaynak şirketlerin kendi siteleri — oraya dışarıdan girilemez.`
              : 'Bu platformun bu sorgularda hangi kaynakları okuduğu henüz yeterince ölçülmedi.',
            steps: [
              'Sektörünüzün dizinlerine kaydolun — kayıt açık olan her listeye girin',
              'Wikidata kaydınızı oluşturun; marka kimliğini modelin gözünde netleştirir',
              'Sektör yayınlarına ürün tanıtımı değil, kendi verinizi içeren bir konu önerin',
              'Kaynaklar ekranında türü belirlenmemiş alan adlarını işaretleyin — hangi kapıların açık olduğunu böyle çıkarırız',
            ],
          }],
    };
  },
  mentioned_uncited: c => ({
    headline: 'Anılıyorsunuz ama kaynak gösterilmiyorsunuz',
    why: `${c.label} markanızı biliyor, ancak cevabı üçüncü taraf sitelerden besliyor. Trafiğin gittiği yer orası.`,
    actions: [{
      title: 'Sayfalarınızı alıntılanabilir hale getirin',
      detail: 'Model, doğrudan cevap veren ve atıfı kolay olan sayfaları kaynak seçer.',
      steps: [
        'Her sayfanın ilk paragrafında 40–60 kelimelik doğrudan cevap verin',
        'Başlıkları soru formuna çevirin',
        'En az bir tablo ve sayısal veri ekleyin; modeller sayıyı alıntılamayı sever',
        'FAQPage veya Article schema ile işaretleyin',
      ],
    }],
  }),
  low_rank: c => ({
    headline: 'Anılıyorsunuz ama hep sonda',
    why: `Ortalama sıranız ${c.meanRank?.toFixed(1) ?? '—'}. Cevabın sonunda anılmak, listenin başında anılmakla aynı değer taşımaz.`,
    actions: [{
      title: 'Kategori liderliği sinyallerini güçlendirin',
      detail: 'Sıralama, modelin markayı kategoriyle ne kadar güçlü ilişkilendirdiğini yansıtır.',
      steps: [
        'Ana sayfanızda kategoriyi ve konumunuzu ilk cümlede açıkça belirtin',
        'Organization schema’ya alternateName ve sameAs bağlantılarını ekleyin',
        'Kategori adınızla birlikte anılan üçüncü taraf içerik sayısını artırın',
      ],
    }],
  }),
  losing_to_rival: c => ({
    headline: `${c.rival?.name ?? 'Bir rakip'} bu platformda sizi geçiyor`,
    why: `${c.rival?.name} bu platformda ${c.rival?.mentions} kez anılıyor. Aradaki fark içerik hacminden çok kaynak varlığından geliyor.`,
    actions: [{
      title: `${c.rival?.name ?? 'Rakip'} ile aranızdaki kaynak farkını kapatın`,
      detail: 'Rakibin göründüğü ama sizin görünmediğiniz kaynaklar, en hızlı kapanan açıktır.',
      steps: [
        'Kaynaklar ekranında rakibin geçtiği alan adlarını listeleyin',
        'Aynı listelerde yer almak için editör ve içerik sahipleriyle iletişime geçin',
        'Rakibin sahiplendiği nitelikleri Rakipler ekranındaki nitelik tablosundan okuyun',
        'Kendi ayırt edici niteliğinizi içerikte tekrar tekrar ve somut kanıtla işleyin',
      ],
    }],
  }),
};

/** Engine-specific overrides layered on top of the generic playbook. */
const PLAYBOOKS: Record<string, Partial<Playbook>> = {
  perplexity: {
    absent: c => ({
      headline: 'Perplexity sizi hiç getirmiyor',
      why: 'Perplexity önce arar, sonra yazar ve neredeyse yalnızca az önce çektiği sayfaları kaynak gösterir. Eski içerik burada görünmez.',
      actions: [{
        title: 'Tazelik ve taranabilirlik',
        detail: 'Bu platform, güncelliği diğerlerinden çok daha ağır tartar.',
        steps: [
          'Kategori sayfalarınızı son 90 gün içinde güncelleyip dateModified işaretleyin',
          'PerplexityBot ve Perplexity-User için robots.txt’te Allow verin',
          'Sunucu tarafı render kullanın — Perplexity JavaScript çalıştırmaz',
          'sitemap.xml’de lastmod alanlarını doğru doldurun',
        ],
      }],
    }),
    mentioned_uncited: c => ({
      headline: 'Perplexity sizi anıyor ama başka siteyi kaynak gösteriyor',
      why: `Perplexity her iddiayı bir bağlantıya dayandırır. Şu an o bağlantıların hiçbiri sizin siteniz değil.`,
      actions: [{
        title: 'Alıntılanabilir sayfa yapısı kurun',
        detail: 'Perplexity, tek bir paragrafta net cevap veren sayfaları tercih eder.',
        steps: [
          'Her sayfada tek bir soruyu ilk paragrafta net cevaplayın',
          'Kaynak gösterdiğiniz verilere dış bağlantı verin — Perplexity atıf zincirini izler',
          'Yayın ve güncelleme tarihini sayfada görünür kılın',
        ],
      }],
    }),
  },

  ai_overviews: {
    absent: () => ({
      headline: 'Google AI Overviews sizi göstermiyor',
      why: 'AI Overviews doğrudan Google indeksinden beslenir. O sorguda ilk sayfada değilseniz özetlenme şansınız yok — burada klasik SEO hâlâ birebir geçerli.',
      actions: [{
        title: 'Önce organik sıralamayı düzeltin',
        detail: 'Bu platform diğerlerinden farklı: giriş bileti Google sıralamasıdır.',
        steps: [
          'Bu sorgular için hedef sayfanızın Google sıralamasını kontrol edin',
          'İlk 10’da değilseniz önce klasik SEO çalışması yapın',
          'Sayfaya FAQPage schema ekleyin — AI Overviews sık sık SSS bloklarını özetler',
          'Search Console’da sayfanın taranıp indekslendiğini doğrulayın',
        ],
      }],
    }),
  },

  chatgpt: {
    absent: c => ({
      headline: 'ChatGPT sizi tanımıyor',
      why: 'ChatGPT eğitim verisiyle canlı aramayı harmanlar. Markanız web genelinde yeterince anılmıyorsa arama açıkken bile yüzeye çıkmaz.',
      actions: [{
        title: 'Web genelinde marka bahsi hacmini artırın',
        detail: 'Bu platformda belirleyici olan backlink değil, markanızın kategoriyle birlikte anıldığı bağımsız içerik sayısıdır.',
        steps: [
          // Yalnızca kayda açık kaynak varsa adıyla önerilir.
          ...(reachableSrc(c, 2).length
            ? [`Kaynaklar ekranında girilebilir işaretli kaynaklara kaydolun — hangisinin ne istediği orada yazıyor`]
            : ['Sektörünüzün dizin ve yayınlarına kaydolun; kayda açık her listeye girin']),
          'Wikipedia veya Wikidata varlığı oluşturun — kimlik netliğini belirgin şekilde artırır',
          'LinkedIn şirket sayfası, Crunchbase ve sektör dizinlerinde tutarlı isim kullanın',
          'Organization schema’da sameAs ile bu profillerin tümünü bağlayın',
        ],
      }],
    }),
  },

  claude: {
    mentioned_uncited: () => ({
      headline: 'Claude sizi anıyor ama kaynak göstermiyor',
      why: 'Claude atfı net olan kaynakları tercih eder ve yazarı belirsiz sayfaları isteksiz alıntılar.',
      actions: [{
        title: 'Yazar ve kaynak netliği ekleyin',
        detail: 'Kim yazdı, ne zaman yazdı, neye dayanıyor — bu üçü atıf ihtimalini yükseltir.',
        steps: [
          'Sayfalara author + Person schema ekleyin',
          'Yazar biyografisi ve yayın tarihini görünür kılın',
          'İddialarınızı dış kaynaklara bağlayın',
        ],
      }],
    }),
  },

  grok: {
    absent: () => ({
      headline: 'Grok sizi getirmiyor',
      why: 'Grok’un canlı arama katmanı diğerlerinden dar; ağırlıklı olarak modelin önceden özümsediği bilgiye dayanır. Sosyal platformlardaki varlık burada görece daha etkilidir.',
      actions: [{
        title: 'Sosyal ve topluluk varlığını güçlendirin',
        steps: [
          'X (Twitter) üzerinde kurumsal hesabınızı aktif ve tutarlı adla kullanın',
          'Kategorinizle ilgili tartışmalarda görünür olun',
          'Sektör dizinlerinde ve topluluk listelerinde yer alın',
        ],
        detail: 'Dar retrieval, marka bilinirliğini daha belirleyici kılar.',
      }],
    }),
  },
};

/* ------------------------------------------------------------------ */

function diagnose(a: {
  measured: boolean; mentionRate: number; citationRate: number;
  meanRank: number | null; rivalLead: number;
}): Diagnosis {
  if (!a.measured) return 'not_measured';
  if (a.mentionRate < 0.15) return 'absent';
  if (a.rivalLead >= 3 && a.mentionRate < 0.6) return 'losing_to_rival';
  if (a.citationRate < 0.15) return 'mentioned_uncited';
  if (a.meanRank !== null && a.meanRank > 2.6) return 'low_rank';
  if (a.mentionRate >= 0.6 && a.citationRate >= 0.3) return 'healthy';
  return 'mentioned_uncited';
}

export async function platformAdvice(
  workspaceId: string,
  engines: { key: string; label: string; weight: number; measured: boolean }[],
  days = 30,
): Promise<PlatformAdvice[]> {
  const [ws] = await sql`select brand_name, domain from workspaces where id = ${workspaceId}`;
  if (!ws) return [];
  const host = String(ws.domain).replace(/^https?:\/\//, '').replace(/^www\./, '');

  // Per-engine performance, straight from the cells we already scored.
  // cell_scores stores the score components as rates, not counts: m is the
  // mention rate for that prompt-engine cell and c the citation rate.
  const perEngine = await sql`
    select cs.engine_key,
           count(*)::int                         as checks,
           avg(cs.score)::numeric                as score,
           avg(cs.m)::numeric                    as mention_rate,
           avg(cs.c)::numeric                    as citation_rate,
           avg(nullif(cs.mean_rank, 0))::numeric as mean_rank
      from cell_scores cs
     where cs.workspace_id = ${workspaceId}
       and cs.scan_date > current_date - ${days}::int
     group by cs.engine_key`;

  const stats = new Map(perEngine.map((r: Record<string, unknown>) => [r.engine_key as string, r]));

  // Which domains each engine actually cited, and whether we are among them.
  const sources = await sql`
    select ar.engine_key, rc.domain, count(*)::int as n
      from run_citations rc
      join answer_runs ar on ar.id = rc.run_id
     where ar.workspace_id = ${workspaceId}
       and ar.asked_at > now() - make_interval(days => ${days})
     group by ar.engine_key, rc.domain
     order by n desc`;

  /* Kaynakları türüne göre sınıflandır.
   *
   * Tavsiye metni buna bağlı: bir dizine profil açılır, bir rakibin sitesine
   * hiç girilemez. Sınıflandırma müşteriler arası ortak tabloda önbelleklenir.
   * allowLlm:false — bu fonksiyon Aksiyon Planı ekranını besler ve bir model
   * yanıtı beklemesi doğru olmaz; bilinmeyen kaynak 'unknown' kalır ve
   * girilemez sayılır, yani hakkında tavsiye üretilmez. */
  const rows = sources as unknown as { engine_key: string; domain: string; n: number }[];
  const rivalRows = await sql<{ domain: string | null }[]>`
    select domain from competitors where workspace_id = ${workspaceId} and active`;
  const kinds = await classifyDomains([...new Set(rows.map(r => r.domain))], {
    rivalDomains: rivalRows.map(r => r.domain).filter((d): d is string => !!d),
    ownDomain: host,
    allowLlm: false,
  });

  const byEngineSources = new Map<string, { domain: string; count: number; ours: boolean; kind: SourceKind }[]>();
  for (const r of rows) {
    const list = byEngineSources.get(r.engine_key) ?? [];
    if (list.length < 8) {
      list.push({
        domain: r.domain, count: r.n, ours: r.domain.endsWith(host),
        kind: kinds.get(r.domain)?.kind ?? 'unknown',
      });
    }
    byEngineSources.set(r.engine_key, list);
  }

  // The strongest rival on each engine, for the "losing to" case.
  const rivals = await sql`
    select ar.engine_key, c.name, count(*)::int as n
      from run_brands rb
      join answer_runs ar on ar.id = rb.run_id
      join competitors c on c.id = rb.competitor_id
     where ar.workspace_id = ${workspaceId}
       and ar.asked_at > now() - make_interval(days => ${days})
       and c.active
     group by ar.engine_key, c.name
     order by n desc`;

  const selfMentions = await sql`
    select ar.engine_key, count(*)::int as n
      from run_brands rb
      join answer_runs ar on ar.id = rb.run_id
     where ar.workspace_id = ${workspaceId} and rb.is_self
       and ar.asked_at > now() - make_interval(days => ${days})
     group by ar.engine_key`;

  const mineByEngine = new Map((selfMentions as unknown as { engine_key: string; n: number }[])
    .map(r => [r.engine_key, r.n]));
  const rivalByEngine = new Map<string, { name: string; mentions: number }>();
  for (const r of rivals as unknown as { engine_key: string; name: string; n: number }[]) {
    if (!rivalByEngine.has(r.engine_key)) rivalByEngine.set(r.engine_key, { name: r.name, mentions: r.n });
  }

  const totalWeight = engines.filter(e => e.measured).reduce((a, e) => a + e.weight, 0) || 1;

  return engines.map(e => {
    const s = stats.get(e.key) as Record<string, unknown> | undefined;
    const checks = Number(s?.checks ?? 0);
    const measured = e.measured && checks > 0;
    const mentionRate = Number(s?.mention_rate ?? 0);
    const citationRate = Number(s?.citation_rate ?? 0);
    const meanRank = s?.mean_rank == null ? null : Number(s.mean_rank);
    const topSources = byEngineSources.get(e.key) ?? [];
    const rival = rivalByEngine.get(e.key);
    const mine = mineByEngine.get(e.key) ?? 0;
    const rivalLead = rival ? rival.mentions - mine : 0;

    const diagnosis = diagnose({ measured, mentionRate, citationRate, meanRank, rivalLead });

    const ctx: Ctx = {
      brand: String(ws.brand_name), host, label: e.label,
      topSources, rival, mentionRate, citationRate, meanRank,
    };
    const book = { ...generic, ...(PLAYBOOKS[e.key] ?? {}) } as Playbook;
    const { headline, why, actions } = book[diagnosis](ctx);

    return {
      engineKey: e.key, engineLabel: e.label, weight: e.weight,
      measured, score: Number(s?.score ?? 0), mentionRate, citationRate, meanRank, checks,
      diagnosis, headline, why, actions, topSources,
      rival: diagnosis === 'losing_to_rival' ? rival : undefined,
      // How much of the achievable score is sitting unclaimed on this engine.
      impact: measured ? Math.round((1 - Number(s?.score ?? 0) / 100) * (e.weight / totalWeight) * 1000) / 10 : 0,
    };
  });
}

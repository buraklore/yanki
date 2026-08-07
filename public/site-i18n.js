/* =====================================================================
   site-i18n.js — Turkish/English switch for the marketing and help pages.

   These pages are plain HTML with no login, so the choice lives in
   localStorage rather than on an account, and ?lang= wins over it so a link
   can be shared in a specific language.

   The dictionary maps Turkish (the source language of these pages) to
   English. Product names stay untranslated in both directions: ChatGPT,
   Google AI Overviews, llms.txt, schema, Search Console. The wording is
   marketing copy, not a literal translation — an English reader should get
   the same argument, not a transliterated Turkish sentence.
   ===================================================================== */

const SITE_I18N = {
  /* --- chrome --- */
  'Ürün': 'Product',
  'Nasıl çalışır': 'How it works',
  'SSS': 'FAQ',
  'Yardım': 'Help',
  'Giriş yap': 'Sign in',
  'Ücretsiz deneyin': 'Try it free',
  'Ücretsiz analiz başlat': 'Start a free analysis',
  'Ücretsiz analiz': 'Free analysis',
  'Yardım merkezi': 'Help centre',
  'Yardım Merkezine Git': 'Go to the help centre',
  'Paneli canlı deneyin →': 'Try the live panel →',
  'Özellikler': 'Features',
  'Kaynaklar': 'Resources',
  'Blog': 'Blog',
  'Yasal': 'Legal',
  'Gizlilik Politikası': 'Privacy Policy',
  'Hizmet Şartları': 'Terms of Service',
  'KVKK Aydınlatma Metni': 'GDPR / KVKK Notice',
  '© 2026 YANKI. Tüm hakları saklıdır.': '© 2026 YANKI. All rights reserved.',
  'Markanızın yapay zekadaki yankısı': 'Your brand’s echo in AI',
  'YANKI; ChatGPT, Perplexity, Gemini ve Claude dahil 7 AI arama motorunda marka görünürlüğünü takip eden, analiz eden ve iyileştirmeye yardımcı olan bir GEO (Generative Engine Optimization) platformudur.':
    'YANKI is a GEO (Generative Engine Optimization) platform that tracks, analyses and helps improve brand visibility across seven AI search engines, including ChatGPT, Perplexity, Gemini and Claude.',

  /* --- hero --- */
  'YANKI — Markanız yapay zeka cevaplarında kaç kez geçiyor?':
    'YANKI — how often does your brand appear in AI answers?',
  'Yapay zeka sizi görüyor mu?': 'Does AI see you?',
  'AI cevaplarındaki görünürlüğünüzü': 'Discover and optimise your',
  'keşfedin ve optimize edin': 'visibility in AI answers',
  'Çoğu marka yapay zeka cevaplarında geçip geçmediğini bile bilmiyor. YANKI markanız için 7 AI platformunu tarar, nerede olduğunuzu gösterir ve daha fazla cevapta yer almanız için yol gösterir.':
    'Most brands have no idea whether they appear in AI answers at all. YANKI scans seven AI platforms for your brand, shows you where you stand, and maps the way into more answers.',
  'YANKI neler yapıyor?': 'What does YANKI do?',
  'Kart gerekmez · 7 platform · 15 dil · Kurulum 2 dakika':
    'No card required · 7 platforms · 15 languages · 2-minute setup',
  '7 AI motoru. 24 saatlik otomatik tarama.': 'Seven AI engines. Scanned automatically, every day.',
  'Markanız, rakipleriniz ve sorgularınız tek ekranda. Skor nerede yükseldi, nerede düştü — hiçbir değişiklik gözünüzden kaçmaz.':
    'Your brand, your competitors and your prompts on one screen. Where the score rose, where it fell — nothing slips past you.',
  'Canlı ürün': 'Live product',
  'Analitik': 'Analytics',

  /* --- blind spot --- */
  'Kör nokta': 'The blind spot',
  'Google sıralamalarınızı takip edebiliyorsunuz. Peki ya AI aramaları?':
    'You can track your Google rankings. What about AI search?',
  'Arama artık on mavi bağlantı değil, üç isimlik bir kısa liste. O listede yoksanız müşteri sizi hiç görmüyor — ve bunu hiçbir analitik aracınız söylemiyor.':
    'Search is no longer ten blue links; it is a shortlist of three names. If you are not on it, the customer never sees you — and no analytics tool tells you so.',
  'Cevap kutusunda ikinci sayfa yok': 'There is no page two in an answer box',
  "Google'da 7. sıradaysanız yine de bulunursunuz. Bir dil modeli üç marka sayıp durduğunda dördüncü olmak, hiç olmamakla aynı şeydir. Görünürlük ikili bir duruma dönüştü: içerdesiniz ya da yoksunuz.":
    'Ranking seventh on Google still gets you found. When a language model names three brands and stops, being fourth is the same as not existing. Visibility has become binary: you are in the answer or you are not.',
  'Tipik bir AI cevabında adı geçen marka sayısı': 'Brands typically named in one AI answer',
  "Analitik araçlarınız AI'ı takip etmiyor": 'Your analytics does not track AI',
  "AI platformlarından gelen ziyaretlerin büyük kısmı referrer taşımıyor ve GA4'te doğrudan trafik kovasına düşüyor. Kanalın gerçek ağırlığını göremediğiniz için bütçe de oraya akmıyor.":
    'Most visits from AI platforms carry no referrer and land in the direct bucket in GA4. Because you cannot see the channel’s real weight, budget never follows it.',
  'AI trafiğini kendi başına ayrıştıramaz': 'cannot separate AI traffic on its own',
  'SEO kuralları birebir geçerli değil': 'SEO rules do not transfer one-to-one',
  "Modeller backlink profilinden çok marka bahsi, yapılandırılmış veri ve alıntılanabilir içeriğe bakıyor. Üstelik çoğu AI tarayıcısı JavaScript çalıştırmıyor — client-side içeriğiniz onlar için boş sayfa.":
    'Models weigh brand mentions, structured data and quotable content far more than a backlink profile. And most AI crawlers do not execute JavaScript — client-side content is a blank page to them.',
  'Client-side içerik çoğu AI botunda görünmez': 'Client-side content is invisible to most AI bots',

  /* --- modules --- */
  'Altı modül, tek platform': 'Six modules, one platform',
  'Görünürlüğünüzü tespit etmekle kalmaz, optimize eder ve artırmanıza yardımcı oluruz.':
    'We do not just measure your visibility — we help you optimise and grow it.',
  'YANKI, markalara AI arama motorlarındaki görünürlüklerini ölçme, düzeltme ve büyütme araçlarını birlikte sunar. Ölçümden içerik üretimine kadar döngüyü tek panelde kapatır.':
    'YANKI gives brands the tools to measure, fix and grow their standing in AI search engines — closing the loop from measurement to content in a single panel.',
  '7 PLATFORM · GÜNLÜK': '7 PLATFORMS · DAILY',
  '58+ FAKTÖR': '58+ FACTORS',
  '50 RAKİP': '50 COMPETITORS',
  'KAYNAK GRAFİĞİ': 'SOURCE GRAPH',
  'AKSİYON PLANI': 'ACTION PLAN',
  'llms.txt · SCHEMA': 'llms.txt · SCHEMA',
  'Her gün 7 AI platformunda markanızı görün': 'See your brand on seven AI platforms every day',
  "YANKI her gün, belirlediğiniz sorgularla ChatGPT, Google AI Overviews, Gemini, Perplexity, Claude, Grok ve DeepSeek'i sorgular. Kimin bahsedildiğini, ne söylendiğini ve pozisyonunuzun nasıl değiştiğini görürsünüz. Her sorgu gün içinde 5 kez, bağımsız oturumlarda çalışır; sonuç ortalama ve güven aralığıyla raporlanır.":
    'Every day YANKI puts your prompts to ChatGPT, Google AI Overviews, Gemini, Perplexity, Claude, Grok and DeepSeek. You see who is named, what is said, and how your position moves. Each prompt runs five times in independent sessions, and the result is reported as an average with a confidence interval.',
  'AI sizi neden görmüyor? 58+ faktör gösterir': 'Why AI cannot see you — 58+ factors, scored',
  "Siteniz Google'da sıralanıyor olabilir ama AI'ın aradığı sinyallerde sınıfta kalıyor olabilir. Denetim; varlık netliği, yapılandırılmış veri, cevaba uygun içerik yapısı, alıntılanabilirlik, render ve tazelik başlıklarında 58+ faktörü tek tek puanlar ve her başarısız faktör için kopyalanabilir düzeltme kodu verir.":
    'Your site may rank on Google and still fail the signals AI looks for. The audit scores 58+ factors across entity clarity, structured data, answer-ready structure, citability, rendering and freshness — and hands you copy-ready code for every one that fails.',
  '50 rakibe kadar takip edin, kimin tercih edildiğini bilin':
    'Track up to 50 competitors and know who gets picked',
  "Her sorguda ve her platformda AI'ın kimi önerdiğini görün. Rakiplerinizin sizi nerede geçtiğini ısı haritasında yan yana okuyun. Nitelik analizi ise modelin her markaya hangi sıfatları yüklediğini gösterir — konumlandırma açığınızı buradan yakalarsınız.":
    'See who the models recommend, prompt by prompt and platform by platform. Read the heat map to find exactly where competitors overtake you. Attribute analysis shows which qualities each brand is associated with — that is where your positioning gap shows up.',
  'Modelin okuduğu kaynakları görün': 'See the sources the model reads',
  'Modeller sizi çoğunlukla sitenizden değil üçüncü taraflardan öğrenir. Alıntı grafiği, cevapları besleyen alan adlarını sayfa düzeyinde listeler; Türkiye pazarında öne çıkan Ekşi Sözlük, Şikayetvar, DonanımHaber ve YouTube gibi kaynaklarda rakibinizle aranızdaki farkı sayıyla gösterir.':
    'Models learn about you mostly from third parties, not from your own site. The citation graph lists the domains feeding those answers page by page, and quantifies the gap between you and your rivals on the sources that matter in your market.',
  'Size özel, önceliklendirilmiş aksiyon planı': 'A prioritised action plan, specific to you',
  'Genel tavsiye değil: şu sayfalar, şu sorgular, şu platformlar. AI Insights nerede zemin kaybettiğinizi bulur, işleri tahmini skor etkisi ve efora göre sıraya koyar ve 30/60/90 günlük bir yol haritasına böler. Her iş kaleminin altında adım adım talimat ve doğrulama komutu bulunur.':
    'Not generic advice: these pages, these prompts, these platforms. AI Insights finds where you are losing ground, ranks the work by estimated score impact against effort, and splits it into a 30/60/90-day roadmap. Every task comes with step-by-step instructions and a command to verify it.',
  'Teknik GEO dosyaları, birkaç tıkla hazır': 'Technical GEO files, ready in a few clicks',
  'llms.txt, Organization ve Product schema, meta etiketler, robots.txt AI botu kuralları. Sitenizi AI tarayıcılarına okunur kılan dosyalar küçüktür ama farkı bunlar yaratır. YANKI bunları markanıza göre üretir ve sunucu loglarından gerçekten taranmaya başlandığını doğrular.':
    'llms.txt, Organization and Product schema, meta tags, robots.txt rules for AI bots. The files that make your site readable to AI crawlers are small, but they are what makes the difference. YANKI generates them for your brand and confirms from server logs that crawling has actually started.',

  /* --- setup --- */
  'Kurulum': 'Setup',
  '2 dakikada kurun, izleyin ve optimize edin.': 'Set up in two minutes, then track and optimise.',
  'Markanızı, rakiplerinizi ve hedef sorgularınızı bir kez ekleyin. YANKI her gün 7 AI platformunu tarar, sonuçları analiz eder ve size net bir aksiyon planı sunar. Kurulum 2 dakika, gerisini biz hallederiz.':
    'Add your brand, your competitors and your target prompts once. YANKI scans seven AI platforms every day, analyses the results and hands you a clear action plan. Setup takes two minutes; we handle the rest.',
  '2 dakikada kurulum': 'Two-minute setup',
  'Marka adınızı girin, rakiplerinizi seçin, sorgularınızı ekleyin. Dilerseniz GA4 ve Search Console bağlayarak AI görünürlüğünün trafiğe dönüşümünü de görün. Teknik bilgi gerektirmez.':
    'Enter your brand name, pick your competitors, add your prompts. Connect GA4 and Search Console if you want to see how AI visibility converts into traffic. No technical knowledge needed.',
  '7 AI platformu': 'Seven AI platforms',
  'ChatGPT, Google AI Overviews, Gemini, Perplexity, Claude, Grok ve DeepSeek. 15 dilde, ülke bazlı sonuçlarla, tek panelden takip edin.':
    'ChatGPT, Google AI Overviews, Gemini, Perplexity, Claude, Grok and DeepSeek — in 15 languages, with country-level results, from one panel.',
  'Her gün taze veri': 'Fresh data every day',
  'Görünürlüğünüz nerede arttı, nerede düştü anında görün. Her cevabın ham metni saklanır; skorun nereden geldiğini istediğiniz an açıp okuyabilirsiniz.':
    'See instantly where your visibility rose and where it fell. The raw text of every answer is kept, so you can open any score and read exactly where it came from.',
  'Aksiyon planı': 'Action plan',
  'Sadece grafik değil, ne yapmanız gerektiğini söyleyen öneriler. Etki ve efora göre sıralanmış iş listesi, 30/60/90 günlük yol haritası. Veriyi stratejiye çevirin.':
    'Not just charts — recommendations that tell you what to do. A task list ranked by impact against effort, and a 30/60/90-day roadmap. Turn the data into strategy.',

  /* --- stats --- */
  'Tek panelde, uçtan uca AI görünürlüğü.': 'End-to-end AI visibility, in one panel.',
  'AI platformu': 'AI platforms',
  'Site denetim faktörü puanlanır': 'Site audit factors scored',
  'AI görünürlük aracı': 'AI visibility tools',
  'Desteklenen dil': 'Supported languages',

  /* --- FAQ --- */
  'Sıkça sorulan sorular': 'Frequently asked questions',
  'YANKI tam olarak ne yapıyor?': 'What exactly does YANKI do?',
  'Panel neden İngilizce?': 'Which languages does the panel support?',
  'Dil modelleri her seferinde farklı cevap veriyor. Ölçüm güvenilir mi?':
    'Language models answer differently every time. Is the measurement reliable?',
  'GEO ile SEO arasındaki fark ne?': 'What is the difference between GEO and SEO?',
  'Cevapları nasıl topluyorsunuz?': 'How do you collect the answers?',
  'Kaç günde sonuç görürüm?': 'How long until I see results?',
  'Rakiplerimi takip edebilir miyim?': 'Can I track my competitors?',
  'Ajans olarak müşterime kendi markamla sunabilir miyim?':
    'As an agency, can I offer this to clients under my own brand?',
  'Verilerim güvende mi?': 'Is my data safe?',
  'Merak ettiğiniz bir şey daha mı var?': 'Still wondering about something?',
  '150+ soru ve rehberden oluşan yardım merkezimizde aradığınız cevap büyük ihtimalle var.':
    'Our help centre has 150+ questions and guides — the answer you need is probably already there.',

  /* --- CTA --- */
  'AI markanız hakkında ne söylüyor? Öğrenin ve optimize edin.':
    'What is AI saying about your brand? Find out, then improve it.',
  '7 platformda markanızı tarayın, rakiplerinizle karşılaştırın, eksiklerinizi görün ve tamamlayın.':
    'Scan your brand across seven platforms, benchmark against competitors, see the gaps and close them.',


  /* --- help centre categories --- */
  'Başlangıç': 'Getting started',
  "YANKI'nın temellerini öğrenin ve ilk markanızı kurun":
    'Learn the basics and set up your first brand',
  'AI İzleme': 'AI monitoring',
  'AI platformlarında marka görünürlüğünüzü nasıl takip edersiniz':
    'How to track your brand visibility across AI platforms',
  'Site Denetimi': 'Site audit',
  'Sitenizin AI hazırlığını denetleyin ve skorunuzu yükseltin':
    'Audit your site’s AI readiness and raise your score',
  'Rakip Analizi': 'Competitor analysis',
  'Skor ve Metrikler': 'Scores and metrics',
  'Araçlar ve Üreteçler': 'Tools and generators',
  'Entegrasyonlar': 'Integrations',
  'Plan ve Faturalama': 'Plans and billing',
  'Hesap ve Güvenlik': 'Account and security',
  'Sorun Giderme': 'Troubleshooting',

  /* --- help centre --- */
  'YANKI Yardım Merkezi — Rehberler ve sık sorulan sorular':
    'YANKI Help Centre — guides and frequently asked questions',
  'Size nasıl': 'How can we',
  'yardımcı olabiliriz?': 'help you?',
  'Rehberler, kurulum adımları ve sık sorulan sorular. Aradığınız cevabı bulamadıysanız destek ekibimiz her zaman yanınızda.':
    'Guides, setup steps and frequently asked questions. If you cannot find the answer, our support team is here.',
  'Kategoriler': 'Categories',
  'Bir kategori seçin veya arama yapın': 'Pick a category or search',
  'Popüler sorular': 'Popular questions',
  'En çok okunan 8 makale': 'The eight most-read articles',
  'Aradığınız cevabı bulamadınız mı?': 'Did not find what you were looking for?',
  'Sorularınız için destek ekibimize yazın, en kısa sürede size dönelim. Ortalama ilk yanıt süresi 4 saat.':
    'Write to our support team and we will get back to you quickly. Average first response time is four hours.',
  'Bize ulaşın': 'Contact us',
  'Bir soru yazın — örneğin: llms.txt nasıl eklenir?':
    'Type a question — for example: how do I add llms.txt?',
  'makale': 'articles',
};

/* Reverse map, so switching back to Turkish restores the source copy. */
const SITE_I18N_BACK = Object.fromEntries(
  Object.entries(SITE_I18N).map(([tr, en]) => [en, tr]));

function siteLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'tr') return q;
  try { return localStorage.getItem('yanki_lang') === 'en' ? 'en' : 'tr'; } catch { return 'tr'; }
}

/**
 * Swaps every text node and translatable attribute whose exact content is a
 * dictionary key. Exact whole-string matching keeps brand names, numbers and
 * anything undeclared untouched.
 */
function applySiteLang(lang) {
  const map = lang === 'en' ? SITE_I18N : SITE_I18N_BACK;
  const norm = new Map();
  for (const k in map) norm.set(k.replace(/\s+/g, ' ').trim(), map[k]);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('script,style,pre,code')) return NodeFilter.FILTER_REJECT;
      return n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  let n; while (n = walker.nextNode()) nodes.push(n);
  for (const node of nodes) {
    const key = node.textContent.replace(/\s+/g, ' ').trim();
    const hit = norm.get(key);
    if (hit) node.textContent = node.textContent.replace(node.textContent.trim(), hit);
  }
  document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => {
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (v && norm.get(v.trim())) el.setAttribute(attr, norm.get(v.trim()));
    }
  });

  document.documentElement.lang = lang;
  document.querySelectorAll('[data-lang-btn]').forEach(b => {
    b.textContent = lang === 'en' ? 'TR' : 'EN';
    b.title = lang === 'en' ? 'Türkçeye geç' : 'Switch to English';
  });
}

function toggleSiteLang() {
  const next = siteLang() === 'en' ? 'tr' : 'en';
  clearTimeout(window.__langTimer);   // drop any pending re-apply
  try { localStorage.setItem('yanki_lang', next); } catch { /* private mode */ }
  applySiteLang(next);
  // Keep the app in step: a visitor who reads the site in English expects the
  // product in English too.
  document.querySelectorAll('a[href^="/app"],a[href^="/kayit"],a[href^="/giris"]').forEach(a => {
    const u = new URL(a.getAttribute('href'), location.origin);
    u.searchParams.set('lang', next);
    a.setAttribute('href', u.pathname + u.search);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applySiteLang(siteLang());
});

/**
 * Parts of the help centre are rendered by script after load, and clicking a
 * category re-renders them. Re-running the pass on any subtree that changes
 * keeps those in step without the page having to call us.
 */
new MutationObserver(muts => {
  if (siteLang() !== 'en') return;
  const touched = muts.some(m => m.addedNodes.length);
  if (touched) {
    clearTimeout(window.__langTimer);
    // Re-check inside the timeout: the user may have switched back to Turkish
    // in the 40ms since the mutation, and re-applying English would undo it.
    window.__langTimer = setTimeout(() => { if (siteLang() === 'en') applySiteLang('en'); }, 40);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

# YANKI

AI görünürlük (GEO / AEO) platformu. Markanızın ChatGPT, Gemini, Claude,
Perplexity, Grok, DeepSeek ve Google AI Overviews cevaplarında kaç sorguda
geçtiğini ölçer, rakiplerle karşılaştırır ve skoru yükseltmek için
önceliklendirilmiş bir plan üretir.

Bu bir prototip değil. Kayıt, oturum, veritabanı, iş kuyruğu, gerçek sağlayıcı
çağrıları ve canlı site denetimi çalışır durumda.

```
app/api/          REST uçları — auth, workspaces, prompts, competitors,
                  scan, results, answers, audit, engines, cron
lib/              entity · score · extract · engines · audit · prompts · scan
public/           marketing.html · app.html · help.html · auth.html
db/schema.sql     Postgres şeması, SKIP LOCKED iş kuyruğu
scripts/          migrate.mjs
worker.mjs        VPS için kalıcı worker (Vercel'de gerekmez)
```

---

## Kurulum

Adım adım, hiçbir şey kurmadan tarayıcıdan: **[KURULUM.md](KURULUM.md)**

Kısa özet:

```bash
cp .env.example .env.local     # DATABASE_URL + en az bir sağlayıcı anahtarı
npm install
npm run db:push                # şemayı uygular, 7 motoru kaydeder
npm run dev
```

`npm run db:push` yerine `db/schema.sql` dosyasını veritabanı sağlayıcınızın
SQL editörüne yapıştırabilirsiniz; şema tekrar çalıştırılabilir yazıldı.

### Zamanlama

`vercel.json` gecede bir çalışan tek bir cron tanımlar — Vercel'in ücretsiz
planının izin verdiği sıklık budur. Sistem buna göre tasarlandı:

| Tetikleyici | Ne yapar |
|---|---|
| `/api/cron/enqueue` (gecede bir) | Günün taramasını kuyruğa alır, ardından süresi yettiği kadar işler |
| `/api/results` (panel açıkken) | Bekleyen iş görürse küçük bir grup işler |
| `↻ Rescan` düğmesi | Yeni tarama başlatır ve ilk grubu hemen işler |
| `/api/cron/drain` (opsiyonel) | Sık zamanlama isteyenler için ayrı uç |

Panel açıkken kuyruk kendi kendine ilerler; `SKIP LOCKED` sayesinde birden
fazla sekme aynı anda çekiyorsa bile bir iş iki kez çalışmaz. Panel kapalıyken
de tamamlanmasını istiyorsanız Vercel Pro'da `/api/cron/drain` için 2 dakikalık
bir cron ekleyin, ya da dışarıdan çağırın.

VPS'te bu tartışma tamamen ortadan kalkar:

```bash
npm run build && npm start
pm2 start worker.mjs --name yanki-worker
```

## Nasıl çalışıyor

**Tarama.** Her sorgu, her motorda birden çok kez sorulur. Dil modelleri
deterministik değildir; tek koşuya bakan bir ölçüm yanıltıcıdır. Sonuç
ortalama olarak, yanında %95 güven aralığıyla raporlanır. Aralık 4 puandan
genişse metrik "düşük güven" işaretlenir.

**Marka tespiti iki katmanlıdır.** Önce Türkçe farkındalıklı bir eşleştirici
aday bulur — `İ/I/ı` katlaması, ek çekimleri (`Zeytin CRM'in`), diyakritiksiz
yazım. Sonra ucuz bir model **yalnızca veto eder ve derecelendirir**. Model
asla yeni bir bahis uyduramaz; uydurulmuş bir bahis müşterinin skorunu şişirir
ve bu, gönderemeyeceğimiz tek hata türüdür. Hakem erişilemezse satır
`degraded` işaretlenir, sessizce geçilmez.

**Skor formülü açıktır.** `lib/score.ts` içindeki ağırlıklar pazarlama
sayfasıyla aynıdır. Birini değiştirirseniz ikisini aynı commit'te değiştirin —
formülü belgelenmemiş bir yüzde, ajansın müşterisine savunulamaz.

**Maliyet kontrolü koda gömülüdür.** İlk üç koşu uyuşuyorsa dördüncü ve beşinci
alınmaz (~%36 tasarruf), bilgilendirme sorguları haftalık taranır, plan üstü
motorlar hiç kuyruğa girmez.

**Plan kapısı sunucudadır.** Kilitli motorun sayıları tarayıcıya hiç
gönderilmez. Aksi halde "yükseltin görün" herkesin devtools ile aştığı bir
duvar olurdu.

---

## Güvenlik

Kırmaya çalışarak test edildi; bulunan her açık kapatıldı.

**Kiracı izolasyonu.** Çalışma alanı kimliği alan her uç `requireWorkspace`
çağırır. A kiracısı B'nin hiçbir kaynağına ulaşamaz — çalışma alanı, sorgular,
rakipler, ham cevaplar, sonuçlar, denetim, tarama. 25 senaryo ile doğrulandı.

**SSRF koruması.** Denetim ucu kullanıcıdan URL alır. `lib/safe-fetch.ts`
DNS çözümlemesinden *sonra* IP kontrolü yapar — `evil.com` A kaydını
`127.0.0.1`'e yönlendirebildiği için yalnızca alan adına bakmak hiçbir şey
kanıtlamaz. Loopback, özel ağ, link-local ve bulut metadata adresleri
(`169.254.169.254`) engellenir; her yönlendirme adımı yeniden doğrulanır.
Bu olmadan bir müşteri, bulut metadata servisinden IAM kimlik bilgilerini
okutabilirdi.

**Parolalar.** scrypt, `node:crypto` ile — native modül yok, build hiçbir
platformda kırılmaz. Oturumlar veritabanında; çerezdeki token'ın yalnızca
SHA-256'sı saklanır, veritabanı sızsa bile replay edilemez.

**Hız sınırı.** Login 15 dakikada 10 deneme, kayıt saatte 5 hesap, denetim
saatte 20 tarama. Postgres tabanlı sabit pencere: serverless'ta her istek
başka bir instance'a düşebildiği için bellekteki sayaç hiçbir şeyi sınırlamaz.

**Plan yükseltme sunucuda kapalı.** `/api/org/plan` yalnızca *düşürmeye* izin
verir. Aksi halde herkes kendine en üst planı ve beraberindeki sağlayıcı
harcamasını bedava verebilirdi. Yükseltme ödeme sağlayıcısının webhook'undan
gelmelidir.

**Girdi doğrulama.** Zod hataları 400 döner, 500 değil. Bozuk JSON, geçersiz
UUID, 5000 elemanlı dizi, negatif değer — hepsi net mesajla reddedilir.

## Henüz yok

Dürüst olmak gerekirse bunlar arayüzde boş durum gösteriyor, sahte veri değil:

- **GA4 ve Search Console** — OAuth akışı gerekiyor. Trafik ve Arama
  Performansı ekranları bağlanana kadar boş.
- **Bot trafiği** — sunucu/CDN log alımı gerekiyor. Şema hazır, yutucu değil.
- **Nitelik analizi** — hakem modeli ve birkaç yüz cevaplık külliyat gerekiyor.
- **Faturalama** — `/api/org/plan` yükseltmeyi 402 ile reddediyor. Ödeme
  sağlayıcısı entegre edilip webhook'u bu ucu çağırana kadar plan yükseltmesi
  veritabanından elle yapılır.
- **Beyaz etiket** — `organizations.white_label_host` alanı şemada var,
  middleware yazılmadı.

## Doğrulama

```bash
npm test                    # çekirdek kütüphaneler (66 test)
node qa/full.js             # uçtan uca, canlı sunucuya karşı (70 iddia)
node qa/sec.js              # kiracı izolasyonu (25 iddia)
node qa/sec2.js             # SSRF, yetki yükseltme, hız sınırı, girdi doğrulama
node qa/sec3.js             # parola akışları, oturum süresi, denetim sertleştirme
node qa/sec4.js             # XSS — her kullanıcı alanına enjeksiyon denemesi
node qa/sec5.js             # kuyruk eşzamanlılığı ve toplam sağlayıcı arızası
node qa/vis-live.js         # görsel/erişilebilirlik, 17 ekran × 2 kırılım
```

`qa/full.js` gerçek bir tarayıcıda kayıt olur, onboarding'i tamamlar, tarama
kuyruğunu işletir, 14 rotayı gezer, CRUD yapar, canlı bir siteyi denetler,
dört üreteci ve içerik yazıcıyı çalıştırır, yedi dosya indirir ve sayfayı
yenileyip oturumun korunduğunu doğrular.

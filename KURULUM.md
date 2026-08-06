# Kurulum

Bilgisayarınıza hiçbir şey kurmanıza gerek yok. Her şey tarayıcıdan yapılır.
Sırayla gidin, her adımın sonunda ne görmeniz gerektiğini yazdım.

Toplam süre: **yaklaşık 20 dakika** (API anahtarı hesapları hariç).

---

## Adım 1 — Veritabanı açın (5 dakika)

1. [neon.tech](https://neon.tech) adresine gidin, **Sign up** → GitHub ile giriş yapın
2. **Create project** düğmesine basın
3. Şunları girin:
   - Project name: `yanki`
   - Region: **Europe (Frankfurt)**
4. **Create** deyin

Proje açılınca ekranda bir **Connection string** kutusu göreceksiniz. Üstünde
**Pooled connection** yazan bir seçenek var, onu işaretleyin ve dizeyi kopyalayın.

Şuna benzeyecek:

```
postgresql://neondb_owner:AbC123@ep-cool-bird-12345-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

Bu dizeyi bir yere not edin, birazdan lazım olacak.

> **Dikkat:** Sonunda `?sslmode=require` yazmalı. Yoksa bağlantı çalışmaz.

---

## Adım 2 — Veritabanı tablolarını oluşturun (2 dakika)

1. İndirdiğiniz zip klasöründe `db` klasörünü açın
2. İçindeki `schema.sql` dosyasını **Not Defteri** ile açın (sağ tık → Birlikte aç → Not Defteri)
3. `Ctrl+A` ile hepsini seçin, `Ctrl+C` ile kopyalayın
4. Neon panelinde sol menüden **SQL Editor**'e tıklayın
5. Kutuya `Ctrl+V` ile yapıştırın
6. **Run** düğmesine basın

Yeşil bir onay mesajı görmelisiniz. Doğrulamak için aynı kutuya şunu yazıp
tekrar **Run** deyin:

```sql
select count(*) from engines;
```

Sonuç **7** çıkmalı. Çıktıysa veritabanı hazır.

---

## Adım 3 — API anahtarlarını alın

Her sağlayıcıda hesap açıp **kredi yüklemeniz** gerekiyor. Kredi yüklemezseniz
anahtar üretilse bile çağrılar reddedilir. Başlangıç için her birine 10–20
dolar yeterli.

| Sağlayıcı | Adres |
|---|---|
| OpenAI (ChatGPT) | platform.openai.com → API keys |
| Anthropic (Claude) | console.anthropic.com → API keys |
| Google Gemini | aistudio.google.com → Get API key |
| Perplexity | perplexity.ai/settings/api |
| xAI (Grok) | console.x.ai |
| DeepSeek | platform.deepseek.com |
| SerpApi (AI Overviews) | serpapi.com |

Anahtarları bir metin dosyasına kaydedin, hangisi hangisi karışmasın.

**İkisiyle başlayabilirsiniz** — OpenAI ve Anthropic yeterli. Diğerlerini
sonra eklerseniz sistem kendiliğinden kullanmaya başlar, hiçbir şey
değiştirmeniz gerekmez. Anahtarı olmayan platform sessizce atlanır.

---

## Adım 4 — GitHub'a yükleyin (5 dakika)

1. [github.com](https://github.com) → sağ üstteki **+** → **New repository**
2. Repository name: `yanki`
3. **Private** seçin
4. **"Add a README file" kutusunu İŞARETLEMEYİN**
5. **Create repository**

Açılan sayfada **uploading an existing file** yazan mavi bağlantıya tıklayın.

Zipten çıkardığınız klasörü açın. İçindeki **her şeyi seçip** (klasörün
kendisini değil, içindekileri) tarayıcı penceresine sürükleyin.

Yükleme bitince sayfanın altındaki **Commit changes** düğmesine basın.

> Nokta ile başlayan dosyalar (`.gitignore`, `.env.example`) bilgisayarınızda
> gizli olabilir. Görünmüyorlarsa sorun değil, ikisi de deploy için gerekli değil.

---

## Adım 5 — Vercel'e yükleyin (5 dakika)

1. [vercel.com/new](https://vercel.com/new) → GitHub ile giriş yapın
2. `yanki` reposunun yanındaki **Import** düğmesine basın
3. Framework Preset otomatik **Next.js** gelecek. **Hiçbir şeye dokunmayın.**
4. **Environment Variables** yazan bölümü açın

Şimdi tek tek şunları ekleyin. Her biri için Name ve Value kutusunu doldurup
**Add** deyin:

| Name | Value |
|---|---|
| `DATABASE_URL` | Adım 1'de kopyaladığınız Neon dizesi |
| `CRON_SECRET` | Klavyeden rastgele 40+ karakter yazın |
| `OPENAI_API_KEY` | OpenAI anahtarınız |
| `ANTHROPIC_API_KEY` | Anthropic anahtarınız |
| `GOOGLE_AI_API_KEY` | varsa |
| `PERPLEXITY_API_KEY` | varsa |
| `XAI_API_KEY` | varsa |
| `DEEPSEEK_API_KEY` | varsa |
| `SERP_PROVIDER_KEY` | varsa |

`CRON_SECRET` için özel bir araç gerekmez. Klavyeden gelişigüzel uzun bir
metin yazın, tahmin edilmesin diye var.

5. **Deploy** düğmesine basın ve 1–2 dakika bekleyin

---

## Adım 6 — Çalıştığını kontrol edin

Vercel size `https://yanki-xxxx.vercel.app` gibi bir adres verir.

**Önce şunu açın:**

```
https://ADRESINIZ.vercel.app/api/health
```

`{"ok":true,...}` görmelisiniz. Görmüyorsanız Adım 7'deki sorun listesine bakın.

**Sonra adresi sisteme tanıtın:**

Vercel'de projenize girin → **Settings** → **Environment Variables** →
**Add another** ile şunu ekleyin:

| Name | Value |
|---|---|
| `APP_URL` | `https://ADRESINIZ.vercel.app` |

Sonra **Deployments** sekmesine gidin, en üstteki deployment'ın sağındaki
üç noktaya tıklayıp **Redeploy** deyin.

> Ortam değişkeni eklediğinizde mutlaka yeniden deploy edin. Yoksa eski
> değerler kullanılmaya devam eder.

**Şimdi sistemi kullanın:**

1. `https://ADRESINIZ.vercel.app/kayit` → hesap açın
2. Kurulum 6 adımını tamamlayın
3. **Ayarlar → Entegrasyonlar → "Test all keys"** düğmesine basın

Bu son adım çok önemli. Her sağlayıcının yanında yeşil **Working** yazmalı.
Kırmızı olan varsa sağlayıcının kendi hata mesajı gösterilir — genelde ya
kredi yüklenmemiştir ya da model adı değişmiştir.

4. Panelde **↻ Rescan** düğmesine basın

Tarama başlar. Paneli açık tutun; sonuçlar geldikçe ekran kendi kendine
güncellenir. İlk taramanın tamamlanması sorgu sayısına göre birkaç dakika
sürebilir.

---

## Adım 7 — Bir şey ters giderse

**Deploy sırasında "Hobby accounts are limited to daily cron jobs" hatası**
Bu sürümde düzeltildi. Hâlâ alıyorsanız GitHub'daki `vercel.json` dosyası
eskidir; zipteki yenisiyle değiştirin.

**`/api/health` 500 veriyor**
Veritabanı bağlantısı kurulamıyor. `DATABASE_URL` değerini kontrol edin —
sonunda `?sslmode=require` var mı? Neon ücretsiz katmanda projeyi uykuya
alabiliyor; bir kez daha deneyin.

**Build başarısız, "DATABASE_URL is not set"**
Değişkeni eklemişsiniz ama redeploy etmemişsiniz. Deployments → Redeploy.

**"Test all keys" hepsinde kırmızı**
Anahtarlar Vercel'e eklenmemiş ya da eklendikten sonra redeploy edilmemiş.

**Tek bir sağlayıcı kırmızı, "model not found" diyor**
O sağlayıcı model adını değiştirmiş. Vercel'de ilgili değişkeni ekleyin,
örneğin `OPENAI_MODEL` = güncel model adı. Kod değişikliği gerekmez.

**"insufficient credits" veya "quota exceeded"**
Sağlayıcı hesabına kredi yüklenmemiş.

**Kayıt olurken "Too many attempts"**
Güvenlik sınırı: aynı bağlantıdan saatte 5 hesap. Bir saat bekleyin, ya da
Neon SQL Editor'de `truncate rate_limits;` çalıştırın.

**Tarama başlıyor ama skor gelmiyor**
Paneli açık bırakın. Sistem, panel açıkken kuyruğu kendi kendine işler.
Sekmeyi kapatırsanız işleme durur, tekrar açtığınızda kaldığı yerden devam eder.

---

## Otomatik günlük tarama hakkında

Vercel'in **ücretsiz planında** zamanlanmış görevler günde bir kez çalışır.
Sistem buna göre tasarlandı:

- Gecede bir otomatik tarama başlar ve elinden geldiği kadar işler
- Kalanı, siz paneli açtığınızda otomatik olarak tamamlanır
- **↻ Rescan** düğmesi istediğiniz an yeni tarama başlatır

Yani ücretsiz planda hiçbir ek servise ihtiyacınız yok.

Panel kapalıyken de taramanın tamamlanmasını istiyorsanız iki seçeneğiniz var:

**Seçenek A — Vercel Pro** (ayda 20 dolar). `vercel.json` dosyasına şu satırı
ekleyin, cron 2 dakikada bir çalışır:

```json
{ "path": "/api/cron/drain", "schedule": "*/2 * * * *" }
```

**Seçenek B — Ücretsiz dış zamanlayıcı.** [cron-job.org](https://cron-job.org)
üzerinden 2 dakikada bir şu adrese istek atacak bir iş kurun:

```
URL:     https://ADRESINIZ.vercel.app/api/cron/drain
Method:  GET
Header:  Authorization: Bearer SIZIN_CRON_SECRET
```

`SIZIN_CRON_SECRET`, Vercel'e girdiğiniz değerin aynısı olmalı.

---

## Maliyet uyarısı

Her tarama gerçek para harcar.

- **Deneme planı:** 10 sorgu × 3 platform × 3 koşu = 90 çağrı
- **Growth ölçeği:** 150 sorgu × 7 platform × 5 koşu = günde binlerce çağrı

İlk gerçek taramayı az sorguyla yapın, sonra sağlayıcı panellerinizden gerçek
maliyeti görün. OpenAI ve Anthropic panellerinde **aylık harcama limiti**
koyabiliyorsunuz — açmadan önce koymanızı öneririm.

Sistemde üç tasarruf mekanizması var: ilk üç koşu uyuşursa kalan koşular
alınmaz, bilgilendirme sorguları haftalık taranır, planınızın üstündeki
platformlar hiç sorulmaz.

---

## Şaşırmamanız gereken şeyler

**Plan yükseltme çalışmaz.** "Upgrade" düğmesi hata verir. Bu bilinçli: ödeme
entegrasyonu olmadan herkes kendine bedava en üst planı verebilirdi. Test için
planı Neon SQL Editor'den değiştirin:

```sql
update organizations set plan = 'growth';
```

**Parola sıfırlama e-posta sağlayıcısı ister.** `RESEND_API_KEY` eklemezseniz
net bir hata verir. Giriş yapmışken parola değiştirme her koşulda çalışır.

**Trafik, Arama Performansı ve Bot Trafiği ekranları boş.** Bunlar Google
hesap bağlantısı ve sunucu logu gerektiriyor. Sahte veri göstermek yerine
neyin gerektiğini yazıyorlar.

**Panel İngilizce, site Türkçe.** Bilerek: ekipler, ajanslar ve müşteriler
aynı terminolojiyi kullansın diye panel dili sabittir.

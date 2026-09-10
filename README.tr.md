# Acta

> **Açık Kaynak Kodlu Günlük Faaliyet Raporlama, Hiyerarşik Onay ve Asenkron Sorumluluk Platformu**

[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-blue.svg)](LICENSE)
[![Node.js Sürümü](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-316192.svg)](https://www.postgresql.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](tsconfig.json)

**[Click here for English Documentation](README.md)**

---

## 💡 Neden Acta?

Modern şirketler ve ekipler faaliyet takibinde iki aşırı uç arasında sıkışır:

1. **Aşırı Karmaşık Proje Yönetim Araçları** (Jira, Linear vb.): Yazılım geliştirme sprintleri için tasarlanmıştır; şirket genelinde günlük faaliyet özetleri, hiyerarşik yönetici onayları veya departman bazlı durum kontrolleri için hantal kalır.
2. **Yapısız Sohbet Standup Botları** (Slack, Teams botları): Kanalları gürültülü bildirimlerle doldurur, denetim izi sunmaz, hiyerarşik onay mekanizması barındırmaz ve zamanla ekip disiplinini kaybeder.

**Acta bu boşluğu doldurur.** Şeffaflığa, departman hiyerarşisine ve mikro-yönetim olmaksızın asenkron çalışma disiplinine ihtiyaç duyan kurumlar için geliştirilmiş açık kaynaklı, bağımsız sunuculu (self-hosted) kurumsal bir platformdur.

---

## ✨ Öne Çıkan Yetenekler

### 1. ⚡ Hızlı Günlük Faaliyet Kaydı
* **30 saniyenin altında kayıt**: Kullanıcının dikkatini dağıtmayan, hız odaklı minimalist arayüz.
* **İstemci tarafı taslak kurtarma**: Gönderilmemiş metinleri yerel cihazda saklar; bağlantı kopsa dahi emek kaybolmaz.
* **Güvenli dosya ekleri**: İçerik imzası (MIME sniffing koruması) ile doğrulanır ve yetki matrisine tabi tutulur.

### 2. 🌳 Organizasyon Ağacı & Görünürlük Matrisi
* **Esnek kurumsal hiyerarşi**: Çok kademeli organizasyon birimleri ve yönetici zincirleri.
* **Yapılandırılabilir akış rotaları**: Bir birimin faaliyetlerinin üst yönetime akıp akmayacağı veya departman içinde gizli kalacağı birim bazında ayarlanabilir.
* **Okundu bilgisi (Read Receipts)**: 2 saniyelik odaklanmış görüntüleme ölçümüyle yöneticilere şeffaf okundu takibi.

### 3. ✅ Hiyerarşik Onaylar ve Düzeltme Döngüsü
* **Doğrudan yönetici onayı**: Onaya tabi birimlerde yazılan kayıtlar onaylanana kadar üst kademelere açılmaz.
* **Gerekçeli düzeltme ve ret**: Yöneticiler standart gerekçe kategorileri seçerek düzeltme isteyebilir veya kaydı reddedebilir.
* **Toplu onay kuyruğu**: Yoğun yöneticiler için hızlı, tek ekranda toplu karar mekanizması.

### 4. 💬 Konuşmalar ve Takip Maddeleri
* **Faaliyet içi soru-cevap**: Faaliyet kaydı üzerinden doğrudan mesajlaşma; cevap verildiğinde sorumluluk otomatik el değiştirir.
* **Bağımsız takip maddeleri**: Faaliyetlere bağlı görev maddeleri; zorunlu kapanış notu ve gerekçeli yeniden açma desteği.

### 5. 🛡️ Kurumsal Güvenlik & Denetim İzi
* **Fiziksel silme yok (Zero Physical Deletes)**: Kayıtlar, kullanıcılar ve birimler asla veritabanından kalıcı silinmez; pasifleştirilir veya gerekçeli iptal edilir.
* **Değişmez denetim kütüğü (Audit Trail)**: Güvenlik, yetkilendirme ve organizasyon değişikliklerini ekleme-odaklı (append-only) olarak kaydeder.
* **Merkezî görünürlük kapısı**: Yetkisiz veri erişimini sıfır toleransla engelleyen tekil yetkilendirme modülü.

### 6. ⏰ Çalışma Takvimleri ve Hatırlatmalar
* **Birim bazlı mesai takvimi**: Her birime özel çalışma günleri, mesai pencereleri ve resmî tatil tanımları.
* **Otonom arka plan işleyicisi (Worker)**: Mesai sonu hatırlatmalarını ve geciken onay/cevap uyarılarını Transactional Outbox modeliyle dağıtır.

### 7. 📊 Şeffaf Skor ve Takdir Sistemi
* **Dönemsel katılım skoru**: Tatil ve izin günlerini otomatik hesaba katan, manipülasyona kapalı objektif katılım puanlaması.
* **Yönetici takdiri**: Puanlama formülünü bozmadan motivasyonu artıran onaylı faaliyet takdiri.
* **Yönetim grafikleri**: Faaliyet eğilimleri, durum dağılımları ve katılım özetleri.

---

## 🛠️ Teknoloji Yığını

* **Çatı:** Next.js 16 (App Router, Server Actions, React 19)
* **Dil:** TypeScript (`strict` mod)
* **Veritabanı & ORM:** PostgreSQL 17 + Prisma 6
* **Arka Plan Süreci:** Bağımsız Node.js Worker (Outbox kuyruğu ve zamanlanmış işler)
* **Stil:** Tailwind CSS v4
* **Doğrulama:** Zod (istemci ve sunucuda ortak şemalar)
* **Test:** Vitest (1.500+ birim ve DB entegrasyon testi) + Playwright (uçtan uca tarayıcı testleri)
* **Kapsayıcılaştırma:** Docker & Docker Compose

---

## 🚀 60 Saniyede Hızlı Kurulum

### Ön Koşullar
* [Docker](https://docs.docker.com/get-docker/) & Docker Compose
* (Yerel geliştirme yapılacaksa) Node.js >= 22 ve [pnpm](https://pnpm.io/) >= 9

### 1. Depoyu İndirin ve Yapılandırın
```bash
git clone https://github.com/ismailcehreli/acta.git
cd acta
cp .env.example .env
```
> **Önemli:** `.env` dosyası içindeki `APP_SECRET` için güçlü bir anahtar belirleyin ve PostgreSQL parolasını ayarlayın.

### 2. Docker Compose ile Başlatın
```bash
docker compose up --build -d
```
Compose; veritabanı geçişlerini (`migrate`), PostgreSQL servisini, Next.js uygulamasını (`app`) ve arka plan işleyicisini (`worker`) otomatik olarak ayağa kaldırır.

### 3. İlk Yöneticiyi Oluşturun
Terminalden ilk kök birimi ve sistem yöneticisi hesabını açın:
```bash
docker compose exec app pnpm kurulum
```
*(Yerel ortamda: `pnpm kurulum`)*. Komut terminale geçici yönetici parolasını yazdıracaktır.

### 4. (İsteğe Bağlı) Zengin Örnek Veri Yükleyin
Sistemi gerçekçi departmanlar, kullanıcılar ve 12 günlük faaliyetlerle test etmek için:
```bash
docker compose exec app pnpm seed:demo
```
*(Yüklenen demo veriler dilediğiniz zaman yönetim panelinden tek tıkla güvenle temizlenebilir).*

Tarayıcınızdan **`http://localhost:3000`** adresini açarak giriş yapabilirsiniz!

---

## 🧪 Test ve Kod Kalitesi

```bash
# Birim ve entegrasyon testlerini çalıştır (1.500+ test)
pnpm test

# Tip kontrolü
pnpm typecheck

# Kod stili kontrolü
pnpm lint

# Playwright uçtan uca testleri
pnpm e2e
```

---

## 📖 Dokümantasyon

* [Mimari Dokümantasyon](docs/architecture.md) — Temel ilkeler, görünürlük katmanı ve veri akışı.
* [Kurulum ve Dağıtım](docs/deployment.md) — Üretim ortamı, ters vekil (reverse proxy) ve SSL.
* [Katkı Sağlama Rehberi](CONTRIBUTING.md) — Geliştirme kuralları ve PR süreçleri.

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında lisanslanmıştır.

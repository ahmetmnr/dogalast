# 🌱 Sıfır Atık Yarışması

Sıfır Atık konusunda farkındalık yaratmak için AI destekli, sesli ve interaktif yarışma uygulaması.

## 🎯 Proje Hakkında

Bu proje, etkinlik katılımcılarına "Sıfır Atık" konusunda eğitici bir yarışma deneyimi sunmak amacıyla geliştirilmiştir. OpenAI Realtime API kullanarak düşük gecikmeli sesli asistan deneyimi sağlar.

### 🌟 Özellikler

- **🎙️ Sesli Etkileşim:** OpenAI Realtime API ile doğal dil işleme
- **⚡ Düşük Gecikme:** WebRTC tabanlı gerçek zamanlı iletişim
- **🏆 Liderlik Tablosu:** Gerçek zamanlı skor takibi
- **🔒 Güvenli:** JWT tabanlı kimlik doğrulama
- **📱 Responsive:** Mobil uyumlu tasarım
- **🛡️ KVKK Uyumlu:** Gizlilik odaklı mimari

## 🚀 Hızlı Başlangıç

### Önkoşullar

- [Bun](https://bun.sh) v1.0+
- [Cloudflare](https://cloudflare.com) hesabı
- OpenAI API anahtarı

### Kurulum

1. **Repoyu klonlayın:**
```bash
git clone https://github.com/your-username/zero-waste-quiz.git
cd zero-waste-quiz
```

2. **Bağımlılıkları yükleyin:**
```bash
bun install
```

3. **Environment variables ayarlayın:**
```bash
cp env.example .env
# .env dosyasını düzenleyerek gerekli değerleri girin
```

4. **Veritabanını oluşturun:**
```bash
# D1 database oluştur
wrangler d1 create zero-waste-quiz-dev

# Migration'ları çalıştır
bun run migrate
```

### Geliştirme

**Backend'i başlatın:**
```bash
bun run dev
```

**Frontend'i başlatın:**
```bash
bun run dev:frontend
```

Uygulama http://localhost:8787 adresinde çalışacaktır.

## 🏗️ Proje Yapısı

```
zero-waste-quiz/
├── src/                    # Backend kaynak kodları
│   ├── controllers/        # İş mantığı kontrolcüleri
│   ├── services/          # Core servisler
│   ├── middleware/        # HTTP middleware'ler
│   ├── routes/            # API route tanımları
│   ├── types/             # TypeScript tip tanımları
│   ├── db/                # Veritabanı katmanı
│   └── utils/             # Yardımcı fonksiyonlar
├── public/                # Frontend statik dosyalar
│   ├── css/               # Stil dosyaları
│   └── js/                # Frontend JavaScript/TypeScript
├── tests/                 # Test dosyaları
├── docs/                  # Dokümantasyon
└── scripts/               # Geliştirme scriptleri
```

## 📝 API Dokümantasyonu

Detaylı API dokümantasyonu için [docs/api.md](docs/api.md) dosyasına bakın.

### Temel Endpoint'ler

- `POST /api/register` - Kullanıcı kaydı
- `GET /api/quiz/start` - Yarışma başlatma
- `POST /api/quiz/answer` - Cevap gönderme
- `GET /api/leaderboard` - Liderlik tablosu
- `GET /ws/realtime` - WebSocket bağlantısı

## 🧪 Test

```bash
# Tüm testleri çalıştır
bun test

# Unit testleri
bun test:unit

# Integration testleri
bun test:integration

# E2E testleri
bun test:e2e
```

## 🚢 Deployment

### Development ortamı
```bash
bun run deploy:dev
```

### Production ortamı
```bash
bun run deploy:prod
```

## 🛠️ Teknoloji Stack

- **Runtime:** Bun
- **Backend:** Hono + TypeScript
- **Database:** Cloudflare D1 + Drizzle ORM
- **Frontend:** Vite + Vanilla TS
- **AI/Voice:** OpenAI Realtime API
- **Deployment:** Cloudflare Workers

## 🤝 Katkıda Bulunma

1. Fork edin
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Değişikliklerinizi commit edin (`git commit -m 'feat: Add amazing feature'`)
4. Branch'inizi push edin (`git push origin feature/amazing-feature`)
5. Pull Request açın

### Commit Conventions

Bu proje [Conventional Commits](https://www.conventionalcommits.org/) standardını kullanır:

- `feat:` Yeni özellik
- `fix:` Bug düzeltmesi
- `docs:` Dokümantasyon
- `style:` Formatting, missing semi colons, etc
- `refactor:` Kod değişikliği (ne bug fix ne de feature)
- `perf:` Performance iyileştirmesi
- `test:` Test ekleme veya düzeltme
- `chore:` Build process veya auxiliary tool değişiklikleri

## 📄 Lisans

Bu proje MIT lisansı altında lisanslanmıştır. Detaylar için [LICENSE](LICENSE) dosyasına bakın.

## 🙏 Teşekkürler

- OpenAI ekibine Realtime API için
- Cloudflare ekibine Workers ve D1 için
- Tüm katkıda bulunanlara

## 📞 İletişim

Sorularınız için issue açabilir veya [email@example.com](mailto:email@example.com) adresinden iletişime geçebilirsiniz.

---

<p align="center">Made with ❤️ for a sustainable future 🌍</p>


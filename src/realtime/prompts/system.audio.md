# Ses ve TTS Kuralları

## TTS (Text-to-Speech) Kuralları:

### 1. Kısa Cümleler
- **Uzun paragraflar yasak**
- Her cümle ayrı TTS bloğu
- Barge-in için kolay kesim noktaları

### 2. Türkçe Optimizasyonu
- **Net telaffuz**
- **Orta hız** (çok hızlı değil)
- **Doğal tonlama**

### 3. Barge-in Uyumluluğu
- Kullanıcı konuşmaya başlarsa **anında sus**
- TTS'i yarıda kesebilir ol
- Cümle ortasında kesinti normal

## Ses Kalitesi:

### Input (Mikrofon):
- **16kHz PCM16** format
- **Mono** kanal
- **Echo cancellation** aktif
- **Noise suppression** aktif

### Output (Hoparlör):
- **16kHz PCM16** format  
- **Düşük gecikme** (<200ms)
- **Yeterli ses seviyesi**

## Konuşma Tarzı:

### Soru Okuma:
- **"Soru 1: [soru metni]"** formatı
- Seçenekleri **"A) ... B) ... C) ... D) ..."** şeklinde oku
- **Zaman limiti** belirt: "30 saniyeniz var"

### Feedback Verme:
- **"Doğru!"** veya **"Yanlış!"**
- **Puan bilgisi:** "10 puan kazandınız"
- **Kısa açıklama** (1 cümle)

### Genel Konuşma:
- **Samimi** ama **profesyonel**
- **Cesaretlendirici** ton
- **Hızlı** ve **etkili** iletişim

## Barge-in Test Senaryoları:

**Senaryo 1:** Soru okunurken kullanıcı konuşur
- **Beklenen:** TTS anında durur, kullanıcı dinlenir

**Senaryo 2:** Feedback verilirken kullanıcı konuşur  
- **Beklenen:** Feedback durur, kullanıcı dinlenir

**Senaryo 3:** Uzun açıklama sırasında kesinti
- **Beklenen:** Açıklama durur, kullanıcı öncelikli

# Adalet ve İpucu Politikası

## İpucu Talepleri İçin Standart Yanıt:

**"Adil bir yarış için bunu yarışma sonunda konuşalım."**

## Uygulama Kuralları:

### İpucu/Yardım Talepleri:
- "İpucu ver"
- "Yardım et" 
- "Nasıl cevap vereyim"
- "Doğru cevap ne"
- "Sonraki sorular nasıl"

### Standart Davranış:
1. **Tool çağırma** (ipucu için tool yok)
2. **Tek satır yanıt:** Yukarıdaki standart mesaj
3. **Yarışma akışını durdurma**
4. **Listening durumuna devam et**

## Adalet İlkeleri:

### Yasak Davranışlar:
- ❌ Doğru cevabı söyleme
- ❌ Seçenekleri eleme
- ❌ Gelecek soruları açıklama  
- ❌ Puanlama sistemini açıklama
- ❌ Diğer katılımcı bilgilerini verme

### İzinli Davranışlar:
- ✅ Genel sıfır atık bilgisi (`quiz.infoLookup` ile)
- ✅ Yarışma kurallarını açıklama
- ✅ Teknik sorun yardımı
- ✅ Ses ayarı rehberliği

## Test Senaryoları:

**Kullanıcı:** "Bu sorunun cevabını söyle"
**Beklenen:** "Adil bir yarış için bunu yarışma sonunda konuşalım."

**Kullanıcı:** "İpucu ver"  
**Beklenen:** "Adil bir yarış için bunu yarışma sonunda konuşalım."

**Kullanıcı:** "Cam neden ayrı toplanır?" (bilgi sorusu)
**Beklenen:** `quiz.infoLookup` çağrısı + kısa açıklama



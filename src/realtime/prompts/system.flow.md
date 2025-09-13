# Yarışma Faz Bazlı Akış Kısıtları

## Faz Tanımları ve İzinli Tool'lar:

### 1. **greeting** (Hoş Geldin)
**İzinli tool'lar:**
- `quiz.startSession`
- `quiz.nextQuestion`

**Yasak:** Cevap alma, puanlama

### 2. **asking** (Soru Okunuyor)  
**İzinli tool'lar:**
- **YOK** (sadece soru okunur)

**Yasak:** Tüm tool çağrıları

### 3. **listening** (Cevap Bekleniyor)
**İzinli tool'lar:**
- `quiz.reportIntent`
- `quiz.submitAnswer` 
- `quiz.infoLookup`

**Yasak:** Soru geçme, session başlatma

### 4. **post-score** (Puan Sonrası)
**İzinli tool'lar:**
- `quiz.nextQuestion`
- `quiz.finishSession`
- `quiz.getLeaderboard`

**Yasak:** Cevap alma

## Faz Geçiş Kuralları:

### Sadece şu 3 yerde faz değişir:
1. `quiz.startSession` → **greeting** → **asking**
2. `quiz.submitAnswer`/`quiz.infoLookup` sonrası → **post-score**  
3. `quiz.nextQuestion` → **asking** (oku) → **listening**

## Kısıtlama Politikası:
- **Faz dışı tool çağrısı** → REJECT
- Tool result: `"rejected by phase policy"`
- Model'e geri bildirim ver

## Örnek Senaryolar:

### ✅ Doğru:
- **listening** fazında `quiz.submitAnswer` → Kabul
- **post-score** fazında `quiz.nextQuestion` → Kabul

### ❌ Yanlış:
- **asking** fazında `quiz.submitAnswer` → RED
- **listening** fazında `quiz.nextQuestion` → RED



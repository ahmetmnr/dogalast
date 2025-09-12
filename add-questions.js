import { Database } from 'bun:sqlite';

const db = new Database('./.wrangler/state/v3/d1/miniflare-D1DatabaseObject/zero-waste-quiz-dev.sqlite');

const questions = [
  {
    id: "q1",
    orderNo: 1,
    text: "Sıfır Atık sisteminde atıklar kaç ana kategoriye ayrılır ve renk kodları nelerdir?",
    correctAnswer: "6 kategori: Plastik (sarı), Metal (gri), Kağıt (mavi), Cam (yeşil), Biyobozunur (kahverengi), Diğer Atıklar (gri)",
    options: ["A) 4 kategori: Plastik, Metal, Kağıt, Cam", "B) 6 kategori: Plastik (sarı), Metal (gri), Kağıt (mavi), Cam (yeşil), Biyobozunur (kahverengi), Diğer Atıklar (gri)", "C) 3 kategori: Kağıt, Plastik, Cam", "D) 5 kategori: Karışık sistem"],
    basePoints: 10
  },
  {
    id: "q2",
    orderNo: 2,
    text: "Türkiye'de Sıfır Atık Projesi'nin başladığı 2017 yılında geri dönüşüm oranı yüzde 13'tü. 2024 yılında bu oran kaça yükseldi?",
    correctAnswer: "36,08 yüzde",
    options: null,
    basePoints: 10
  },
  {
    id: "q3",
    orderNo: 3,
    text: "Sıfır Atık Projesi'nin başladığı 2017'den 2024'e kadar toplam kaç milyon ton atık geri dönüştürüldü?",
    correctAnswer: "59,9 milyon ton",
    options: null,
    basePoints: 20
  },
  {
    id: "q4",
    orderNo: 4,
    text: "Sıfır Atık Projesi kapsamında kurumlar hangi belge sistemine dahil oluyor?",
    correctAnswer: "Temel, Orta ve İleri Seviye",
    options: ["A) Sadece Temel Seviye", "B) Temel, Orta ve İleri Seviye", "C) Sadece İleri Seviye", "D) Belge sistemi yok"],
    basePoints: 10
  },
  {
    id: "q5",
    orderNo: 5,
    text: "Sıfır Atık Projesi ile 7 yılda kaç milyon kişiye eğitim verilmiştir?",
    correctAnswer: "25 milyon kişi",
    options: null,
    basePoints: 15
  },
  {
    id: "q6",
    orderNo: 6,
    text: "Emine Erdoğan Hanımefendi hangi uluslararası ödüle layık görülmüştür?",
    correctAnswer: "BM Küresel Amaçlar Eylem Ödülü",
    options: ["A) Nobel Barış Ödülü", "B) BM Küresel Amaçlar Eylem Ödülü", "C) Çevre Oscar'ı", "D) Yeşil Gezegen Ödülü"],
    basePoints: 15
  },
  {
    id: "q7",
    orderNo: 7,
    text: "2035 yılında Türkiye'nin geri dönüşüm oranı hedefi yüzde kaçtır?",
    correctAnswer: "Yüzde 60",
    options: null,
    basePoints: 10
  },
  {
    id: "q8",
    orderNo: 8,
    text: "Sıfır Atık Projesi ile kaç binada Sıfır Atık Yönetim Sistemi kurulmuştur?",
    correctAnswer: "193 bin bina",
    options: ["A) 150 bin bina", "B) 193 bin bina", "C) 205 bin bina", "D) 250 bin bina"],
    basePoints: 15
  },
  {
    id: "q9",
    orderNo: 9,
    text: "Sıfır Atık Projesi ile ekonomiye kaç milyar lira değer kazandırılmıştır?",
    correctAnswer: "185 milyar lira",
    options: null,
    basePoints: 20
  },
  {
    id: "q10",
    orderNo: 10,
    text: "30 Mart hangi özel gün olarak BM tarafından kabul edilmiştir?",
    correctAnswer: "Uluslararası Sıfır Atık Günü",
    options: ["A) Dünya Su Günü", "B) Uluslararası Sıfır Atık Günü", "C) Dünya Çevre Günü", "D) Dünya Geri Dönüşüm Günü"],
    basePoints: 10
  }
];

const stmt = db.prepare(`
  INSERT OR REPLACE INTO questions 
  (id, order_no, text, correct_answer, options, difficulty, base_points, time_limit, category, is_active) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let added = 0;
questions.forEach(q => {
  try {
    stmt.run(
      q.id, 
      q.orderNo, 
      q.text, 
      q.correctAnswer, 
      q.options ? JSON.stringify(q.options) : null, 
      1, 
      q.basePoints, 
      30, 
      'zero_waste', 
      1
    );
    added++;
    console.log(`✅ ${q.id} eklendi`);
  } catch (error) {
    console.log(`❌ ${q.id} eklenemedi:`, error.message);
  }
});

console.log(`\n🎉 Toplam ${added} soru eklendi!`);

// Kontrol et
const count = db.query('SELECT COUNT(*) as count FROM questions WHERE is_active = 1').get();
console.log(`📊 Database'de toplam ${count.count} aktif soru var`);


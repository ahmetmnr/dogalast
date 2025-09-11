-- Migration: 0005_default_data.sql
-- Description: System settings and default data
-- Date: 2025-09-11

-- ============================================
-- System Settings - Default Values
-- ============================================

-- Privacy and KVKK settings
INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('AUDIO_RETENTION_DAYS', '0', 'Ses verisi saklama süresi (0 = saklanmaz)', 'privacy', 1),
('DATA_RETENTION_DAYS', '365', 'Genel veri saklama süresi (gün)', 'privacy', 1),
('TRANSCRIPT_RETENTION_DAYS', '30', 'Metin dökümü saklama süresi (gün)', 'privacy', 1),
('GDPR_COMPLIANCE_MODE', 'true', 'KVKK/GDPR uyumluluk modu', 'privacy', 1),
('AUDIT_LOG_RETENTION_DAYS', '2555', 'Audit log saklama süresi (7 yıl - KVKK)', 'privacy', 0);

-- Audio and calibration settings
INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('VAD_CALIBRATION_ENABLED', 'true', 'VAD otomatik kalibrasyonu', 'audio', 1),
('DEFAULT_VAD_THRESHOLD', '0.01', 'Varsayılan VAD eşik değeri', 'audio', 0),
('AUDIO_FORMAT', 'pcm16', 'Ses formatı (pcm16, g711_ulaw, g711_alaw)', 'audio', 0),
('AUDIO_SAMPLE_RATE', '16000', 'Ses örnekleme hızı (Hz)', 'audio', 0);

-- Token and security settings
INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('TOKEN_REFRESH_THRESHOLD', '0.75', 'Token yenileme eşiği (sürenin %kaçında)', 'security', 1),
('EPHEMERAL_TOKEN_DURATION', '1h', 'Geçici token süresi', 'security', 0),
('SESSION_TIMEOUT', '1800', 'Oturum zaman aşımı (saniye - 30 dakika)', 'security', 0),
('MAX_LOGIN_ATTEMPTS', '5', 'Maksimum giriş denemesi', 'security', 0),
('LOGIN_LOCKOUT_DURATION', '900', 'Giriş kilitleme süresi (saniye - 15 dakika)', 'security', 0);

-- Performance settings
INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('RATE_LIMIT_REQUESTS_PER_MINUTE', '60', 'Dakika başına istek limiti', 'performance', 1),
('CACHE_TTL_SECONDS', '300', 'Cache yaşam süresi (saniye)', 'performance', 0),
('MAX_CONCURRENT_SESSIONS', '100', 'Maksimum eşzamanlı oturum', 'performance', 0),
('QUERY_TIMEOUT_MS', '5000', 'Sorgu zaman aşımı (milisaniye)', 'performance', 0);

-- Quiz settings
INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('MAX_QUESTIONS_PER_SESSION', '10', 'Oturum başına maksimum soru', 'quiz', 0),
('DEFAULT_TIME_LIMIT', '30', 'Varsayılan soru süresi (saniye)', 'quiz', 0),
('MIN_TIME_LIMIT', '10', 'Minimum soru süresi (saniye)', 'quiz', 0),
('MAX_TIME_LIMIT', '120', 'Maksimum soru süresi (saniye)', 'quiz', 0),
('BASE_POINTS_MULTIPLIER', '1.0', 'Puan çarpanı', 'quiz', 0),
('TIME_BONUS_ENABLED', 'true', 'Süre bonusu aktif mi', 'quiz', 0),
('DIFFICULTY_MULTIPLIER_ENABLED', 'true', 'Zorluk çarpanı aktif mi', 'quiz', 0),
('LEADERBOARD_SIZE', '10', 'Liderlik tablosu büyüklüğü', 'quiz', 0),
('SHOW_CORRECT_ANSWERS', 'true', 'Doğru cevapları göster', 'quiz', 0);

-- System metadata
INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('DATABASE_VERSION', '1.0.0', 'Veritabanı şema versiyonu', 'system', 0),
('SYSTEM_VERSION', '1.0.0', 'Sistem versiyonu', 'system', 0),
('LAST_MIGRATION', '0005_default_data.sql', 'Son uygulanan migration', 'system', 0),
('DEPLOYMENT_DATE', datetime('now'), 'İlk deployment tarihi', 'system', 0);

-- ============================================
-- Default Admin User
-- ============================================
-- Username: admin
-- Password: admin123 (MUST BE CHANGED IN PRODUCTION!)
-- Password hash is for bcrypt with 12 rounds

INSERT OR IGNORE INTO admin_users (
  username, 
  email, 
  password_hash, 
  role, 
  permissions, 
  is_active
) VALUES (
  'admin',
  'admin@zero-waste-quiz.com',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VcSn9Iy/2',
  'super_admin',
  '["all"]',
  1
);

-- ============================================
-- Sample Knowledge Base Entry
-- ============================================

INSERT OR IGNORE INTO knowledge (
  id,
  title,
  content,
  tags,
  category,
  confidence_score,
  is_active
) VALUES (
  1,
  'Sıfır Atık Nedir?',
  'Sıfır atık, atık üretimini minimize etmeyi ve kaynakları maksimum verimlilikle kullanmayı hedefleyen bir yaşam felsefesidir. 5R prensibi ile çalışır: Reddet (Refuse), Azalt (Reduce), Yeniden Kullan (Reuse), Geri Dönüştür (Recycle), Çürüt (Rot). Bu yaklaşım, doğal kaynakların korunması, ekonomik tasarruf ve çevresel sürdürülebilirlik açısından kritik öneme sahiptir.',
  'sıfır atık, 5R, sürdürülebilirlik, çevre',
  'zero_waste',
  1.0,
  1
);

-- Update FTS index for the sample knowledge entry
INSERT OR IGNORE INTO knowledge_fts(rowid, title, content, tags, category)
SELECT id, title, content, tags, category 
FROM knowledge 
WHERE id = 1 AND is_active = 1;

-- ============================================
-- Privacy Policy Version
-- ============================================

INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('PRIVACY_POLICY_VERSION', '1.0', 'Gizlilik politikası versiyonu', 'privacy', 0),
('TERMS_OF_SERVICE_VERSION', '1.0', 'Kullanım koşulları versiyonu', 'privacy', 0),
('CONSENT_VERSION', '1.0', 'Rıza metni versiyonu', 'privacy', 0);

-- ============================================
-- Feature Flags
-- ============================================

INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('FEATURE_ADMIN_PANEL', 'true', 'Admin paneli aktif mi', 'features', 0),
('FEATURE_VOICE_FEEDBACK', 'true', 'Sesli geri bildirim aktif mi', 'features', 0),
('FEATURE_LEADERBOARD_ANIMATION', 'true', 'Liderlik tablosu animasyonları', 'features', 0),
('FEATURE_REALTIME_UPDATES', 'true', 'Gerçek zamanlı güncellemeler', 'features', 0),
('FEATURE_ANALYTICS', 'false', 'Analytics entegrasyonu', 'features', 0);

-- ============================================
-- Logging Configuration
-- ============================================

INSERT OR IGNORE INTO system_settings (key, value, description, category, is_environment_variable) VALUES
('LOG_LEVEL', 'info', 'Log seviyesi (debug, info, warn, error)', 'logging', 1),
('LOG_TO_CONSOLE', 'true', 'Console logging aktif mi', 'logging', 0),
('LOG_TO_DATABASE', 'true', 'Database logging aktif mi', 'logging', 0),
('LOG_REQUEST_BODY', 'false', 'Request body logla (dikkat: sensitive data)', 'logging', 0),
('LOG_RESPONSE_BODY', 'false', 'Response body logla (dikkat: sensitive data)', 'logging', 0);

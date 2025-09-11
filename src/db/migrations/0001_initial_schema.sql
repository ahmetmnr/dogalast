-- Migration: 0001_initial_schema.sql
-- Description: Initial database schema creation
-- Date: 2025-09-11

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================
-- Core Tables
-- ============================================

-- Participants table
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  consent_marketing INTEGER DEFAULT 0 CHECK (consent_marketing IN (0, 1)),
  consent_terms INTEGER NOT NULL CHECK (consent_terms IN (0, 1)),
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  permissions TEXT, -- JSON array of permissions
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_login_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
);

-- Quiz sessions with deterministic ordering
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY, -- UUID
  participant_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'paused', 'abandoned')),
  total_score INTEGER DEFAULT 0 NOT NULL,
  current_question_index INTEGER DEFAULT 0 NOT NULL,
  started_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  completed_at INTEGER,
  last_activity_at INTEGER DEFAULT (unixepoch()) NOT NULL, -- For deterministic ranking
  
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE(participant_id, started_at)
);

-- Questions table
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, -- UUID
  order_no INTEGER NOT NULL UNIQUE,
  text TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  options TEXT, -- JSON array for multiple choice
  difficulty INTEGER DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
  base_points INTEGER DEFAULT 10 NOT NULL,
  time_limit INTEGER DEFAULT 30 NOT NULL, -- seconds
  category TEXT DEFAULT 'zero_waste' NOT NULL,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
);

-- Session questions (many-to-many relationship)
CREATE TABLE IF NOT EXISTS session_questions (
  id TEXT PRIMARY KEY, -- UUID
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  order_in_session INTEGER NOT NULL,
  is_answered INTEGER DEFAULT 0 CHECK (is_answered IN (0, 1)),
  user_answer TEXT,
  is_correct INTEGER CHECK (is_correct IN (0, 1, NULL)),
  points_earned INTEGER DEFAULT 0 NOT NULL,
  response_time INTEGER, -- milliseconds
  presented_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  answered_at INTEGER,
  
  FOREIGN KEY (session_id) REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  UNIQUE(session_id, question_id),
  UNIQUE(session_id, order_in_session)
);

-- ============================================
-- Server-Authoritative Timing (CRITICAL)
-- ============================================

-- Question timings table
CREATE TABLE IF NOT EXISTS question_timings (
  id TEXT PRIMARY KEY, -- UUID
  session_question_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('tts_start', 'tts_end', 'speech_start', 'answer_received')),
  server_timestamp INTEGER NOT NULL, -- Monotonic server time
  client_signal_timestamp INTEGER, -- Client time (for latency calculation)
  network_latency INTEGER, -- Calculated network latency in ms
  metadata TEXT, -- JSON for additional data (transcript, confidence, etc.)
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  
  FOREIGN KEY (session_question_id) REFERENCES session_questions(id) ON DELETE CASCADE,
  UNIQUE(session_question_id, event_type)
);

-- ============================================
-- Knowledge Base
-- ============================================

-- Knowledge base table
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT, -- Comma-separated tags
  category TEXT DEFAULT 'zero_waste' NOT NULL,
  source_url TEXT,
  confidence_score REAL DEFAULT 1.0 CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
);

-- ============================================
-- KVKK Compliance Tables
-- ============================================

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'SELECT')),
  old_values TEXT, -- JSON
  new_values TEXT, -- JSON
  admin_user_id INTEGER,
  participant_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  session_id TEXT,
  privacy_impact TEXT, -- KVKK data processing category
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL
);

-- Data processing activities table
CREATE TABLE IF NOT EXISTS data_processing_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER,
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'registration', 
    'quiz_participation', 
    'audio_processing', 
    'score_calculation', 
    'leaderboard_display', 
    'data_export'
  )),
  data_categories TEXT, -- JSON array: ['personal_data', 'audio_data', 'performance_data']
  processing_purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL, -- KVKK legal basis
  retention_period INTEGER, -- Days
  is_automated INTEGER DEFAULT 1 CHECK (is_automated IN (0, 1)),
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

-- Consent records table
CREATE TABLE IF NOT EXISTS consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'terms_of_service', 
    'privacy_policy', 
    'marketing_communications',
    'audio_processing', 
    'data_sharing', 
    'analytics'
  )),
  consent_given INTEGER NOT NULL CHECK (consent_given IN (0, 1)),
  consent_version TEXT NOT NULL, -- Policy version consented to
  ip_address TEXT,
  user_agent TEXT,
  withdrawal_date INTEGER, -- Timestamp when consent was withdrawn
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

-- ============================================
-- System Configuration
-- ============================================

-- System settings table
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general' NOT NULL,
  is_environment_variable INTEGER DEFAULT 0 CHECK (is_environment_variable IN (0, 1)),
  updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
);

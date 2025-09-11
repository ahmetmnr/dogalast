-- Migration: 0002_indexes.sql
-- Description: Performance optimized indexes
-- Date: 2025-09-11

-- ============================================
-- Participants Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_participants_email 
  ON participants(email);

CREATE INDEX IF NOT EXISTS idx_participants_created_at 
  ON participants(created_at);

-- ============================================
-- Admin Users Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_admin_users_username 
  ON admin_users(username);

CREATE INDEX IF NOT EXISTS idx_admin_users_email 
  ON admin_users(email);

CREATE INDEX IF NOT EXISTS idx_admin_users_role 
  ON admin_users(role);

-- ============================================
-- Quiz Sessions Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_status 
  ON quiz_sessions(status);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_participant 
  ON quiz_sessions(participant_id);

-- Deterministic leaderboard index for tie-breaking
-- Orders by: score DESC, completion time ASC, last activity ASC
CREATE INDEX IF NOT EXISTS idx_leaderboard_deterministic 
  ON quiz_sessions(
    status, 
    total_score DESC, 
    completed_at ASC, 
    last_activity_at ASC
  ) 
  WHERE status = 'completed';

-- ============================================
-- Questions Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_questions_order 
  ON questions(order_no);

CREATE INDEX IF NOT EXISTS idx_questions_category 
  ON questions(category);

CREATE INDEX IF NOT EXISTS idx_questions_difficulty 
  ON questions(difficulty);

CREATE INDEX IF NOT EXISTS idx_questions_active 
  ON questions(is_active)
  WHERE is_active = 1;

-- ============================================
-- Session Questions Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_session_questions_session 
  ON session_questions(session_id);

CREATE INDEX IF NOT EXISTS idx_session_questions_answered 
  ON session_questions(answered_at)
  WHERE answered_at IS NOT NULL;

-- Covering index for efficient session queries
CREATE INDEX IF NOT EXISTS idx_session_questions_covering 
  ON session_questions(
    session_id, 
    order_in_session, 
    answered_at, 
    is_correct, 
    points_earned
  );

-- ============================================
-- Question Timings Indexes (CRITICAL for performance)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_question_timings_session_question 
  ON question_timings(session_question_id);

CREATE INDEX IF NOT EXISTS idx_question_timings_event_type 
  ON question_timings(event_type);

CREATE INDEX IF NOT EXISTS idx_question_timings_server_timestamp 
  ON question_timings(server_timestamp);

-- Partial index for active queries (last 24 hours)
-- Improves performance for recent timing queries
CREATE INDEX IF NOT EXISTS idx_question_timings_active 
  ON question_timings(
    session_question_id, 
    event_type, 
    server_timestamp
  ) 
  WHERE server_timestamp > (unixepoch() - 86400);

-- ============================================
-- Knowledge Base Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_knowledge_category 
  ON knowledge(category);

CREATE INDEX IF NOT EXISTS idx_knowledge_active 
  ON knowledge(is_active)
  WHERE is_active = 1;

-- ============================================
-- Audit Logs Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record 
  ON audit_logs(table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_user 
  ON audit_logs(admin_user_id)
  WHERE admin_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_participant 
  ON audit_logs(participant_id)
  WHERE participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at 
  ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_privacy_impact 
  ON audit_logs(privacy_impact)
  WHERE privacy_impact IS NOT NULL;

-- ============================================
-- Data Processing Activities Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_data_processing_participant 
  ON data_processing_activities(participant_id);

CREATE INDEX IF NOT EXISTS idx_data_processing_type 
  ON data_processing_activities(activity_type);

CREATE INDEX IF NOT EXISTS idx_data_processing_created_at 
  ON data_processing_activities(created_at);

-- ============================================
-- Consent Records Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_consent_records_participant 
  ON consent_records(participant_id);

CREATE INDEX IF NOT EXISTS idx_consent_records_type 
  ON consent_records(consent_type);

CREATE INDEX IF NOT EXISTS idx_consent_records_created_at 
  ON consent_records(created_at);

-- Index for finding active consents
CREATE INDEX IF NOT EXISTS idx_consent_records_active 
  ON consent_records(participant_id, consent_type, consent_given)
  WHERE consent_given = 1 AND withdrawal_date IS NULL;

-- ============================================
-- System Settings Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_system_settings_category 
  ON system_settings(category);


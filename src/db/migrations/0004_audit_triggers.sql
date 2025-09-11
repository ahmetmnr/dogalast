-- Migration: 0004_audit_triggers.sql
-- Description: Audit triggers for KVKK compliance (simplified for D1)
-- Date: 2025-09-11

-- ============================================
-- Note: D1 has limited trigger support
-- These are simplified triggers for basic audit trail
-- More complex auditing should be done at application level
-- ============================================

-- ============================================
-- Updated Timestamp Triggers
-- ============================================

-- Participants updated_at trigger
CREATE TRIGGER IF NOT EXISTS participants_updated_at 
AFTER UPDATE ON participants
BEGIN
  UPDATE participants 
  SET updated_at = unixepoch() 
  WHERE id = NEW.id;
END;

-- Admin users updated_at trigger
CREATE TRIGGER IF NOT EXISTS admin_users_updated_at 
AFTER UPDATE ON admin_users
BEGIN
  UPDATE admin_users 
  SET updated_at = unixepoch() 
  WHERE id = NEW.id;
END;

-- Questions updated_at trigger
CREATE TRIGGER IF NOT EXISTS questions_updated_at 
AFTER UPDATE ON questions
BEGIN
  UPDATE questions 
  SET updated_at = unixepoch() 
  WHERE id = NEW.id;
END;

-- Knowledge updated_at trigger
CREATE TRIGGER IF NOT EXISTS knowledge_updated_at 
AFTER UPDATE ON knowledge
BEGIN
  UPDATE knowledge 
  SET updated_at = unixepoch() 
  WHERE id = NEW.id;
END;

-- System settings updated_at trigger
CREATE TRIGGER IF NOT EXISTS system_settings_updated_at 
AFTER UPDATE ON system_settings
BEGIN
  UPDATE system_settings 
  SET updated_at = unixepoch() 
  WHERE key = NEW.key;
END;

-- ============================================
-- Last Activity Tracking
-- ============================================

-- Update quiz session last_activity_at on any change
CREATE TRIGGER IF NOT EXISTS quiz_sessions_last_activity 
AFTER UPDATE ON quiz_sessions
BEGIN
  UPDATE quiz_sessions 
  SET last_activity_at = unixepoch() 
  WHERE id = NEW.id AND last_activity_at < unixepoch();
END;

-- Update quiz session last_activity_at when questions are answered
CREATE TRIGGER IF NOT EXISTS session_questions_activity 
AFTER UPDATE OF answered_at ON session_questions
WHEN NEW.answered_at IS NOT NULL
BEGIN
  UPDATE quiz_sessions 
  SET last_activity_at = unixepoch() 
  WHERE id = NEW.session_id;
END;

-- ============================================
-- Data Integrity Triggers
-- ============================================

-- Update quiz session score when question is answered
CREATE TRIGGER IF NOT EXISTS update_session_score 
AFTER UPDATE OF points_earned ON session_questions
WHEN NEW.points_earned > 0
BEGIN
  UPDATE quiz_sessions 
  SET total_score = total_score + NEW.points_earned 
  WHERE id = NEW.session_id;
END;

-- Update quiz session status to completed when all questions answered
CREATE TRIGGER IF NOT EXISTS check_session_completion 
AFTER UPDATE OF is_answered ON session_questions
WHEN NEW.is_answered = 1
BEGIN
  UPDATE quiz_sessions 
  SET 
    status = 'completed',
    completed_at = unixepoch()
  WHERE 
    id = NEW.session_id 
    AND status = 'active'
    AND NOT EXISTS (
      SELECT 1 
      FROM session_questions 
      WHERE session_id = NEW.session_id 
      AND is_answered = 0
    );
END;

-- ============================================
-- Privacy Compliance Triggers
-- ============================================

-- Log consent changes (simplified - full audit should be at app level)
CREATE TRIGGER IF NOT EXISTS consent_audit_log 
AFTER UPDATE ON consent_records
WHEN OLD.consent_given != NEW.consent_given
BEGIN
  INSERT INTO audit_logs (
    table_name,
    record_id,
    action,
    participant_id,
    privacy_impact,
    created_at
  )
  VALUES (
    'consent_records',
    NEW.id,
    'UPDATE',
    NEW.participant_id,
    'consent_change',
    unixepoch()
  );
END;

-- Set withdrawal date when consent is revoked
CREATE TRIGGER IF NOT EXISTS consent_withdrawal 
AFTER UPDATE ON consent_records
WHEN OLD.consent_given = 1 AND NEW.consent_given = 0
BEGIN
  UPDATE consent_records 
  SET withdrawal_date = unixepoch() 
  WHERE id = NEW.id;
END;

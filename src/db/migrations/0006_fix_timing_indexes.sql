-- Migration: 0006_fix_timing_indexes.sql
-- Description: Fix problematic unixepoch() index in question_timings
-- Date: 2025-09-14

-- ============================================
-- Remove problematic partial index with unixepoch()
-- ============================================

DROP INDEX IF EXISTS idx_question_timings_active;

-- ============================================
-- Create new covering index without unixepoch()
-- ============================================

CREATE INDEX IF NOT EXISTS idx_question_timings_covering
  ON question_timings(
    session_question_id,
    event_type,
    server_timestamp
  );
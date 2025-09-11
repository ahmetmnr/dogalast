-- Migration: 0003_fts_setup.sql
-- Description: Full-Text Search setup for knowledge base
-- Date: 2025-09-11

-- ============================================
-- FTS5 Virtual Table for Knowledge Base
-- ============================================

-- Create FTS5 virtual table for full-text search
-- Uses porter stemmer and unicode support
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  title,
  content,
  tags,
  category,
  content='knowledge',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 1'
);

-- ============================================
-- Populate FTS Table with Existing Data
-- ============================================

-- Copy existing knowledge data to FTS table
INSERT OR IGNORE INTO knowledge_fts(rowid, title, content, tags, category)
SELECT id, title, content, tags, category 
FROM knowledge
WHERE is_active = 1;

-- ============================================
-- Triggers to Keep FTS in Sync
-- ============================================

-- Trigger for INSERT operations
CREATE TRIGGER IF NOT EXISTS knowledge_ai 
AFTER INSERT ON knowledge 
WHEN NEW.is_active = 1
BEGIN
  INSERT INTO knowledge_fts(rowid, title, content, tags, category)
  VALUES (NEW.id, NEW.title, NEW.content, NEW.tags, NEW.category);
END;

-- Trigger for DELETE operations
CREATE TRIGGER IF NOT EXISTS knowledge_ad 
AFTER DELETE ON knowledge 
BEGIN
  DELETE FROM knowledge_fts WHERE rowid = OLD.id;
END;

-- Trigger for UPDATE operations
-- Handles both content changes and active status changes
CREATE TRIGGER IF NOT EXISTS knowledge_au 
AFTER UPDATE ON knowledge 
BEGIN
  -- Remove old entry
  DELETE FROM knowledge_fts WHERE rowid = OLD.id;
  
  -- Add new entry only if active
  INSERT INTO knowledge_fts(rowid, title, content, tags, category)
  SELECT NEW.id, NEW.title, NEW.content, NEW.tags, NEW.category
  WHERE NEW.is_active = 1;
END;

-- ============================================
-- FTS Search Helper Views
-- ============================================

-- View for easy FTS searching with ranking
CREATE VIEW IF NOT EXISTS knowledge_search AS
SELECT 
  k.id,
  k.title,
  k.content,
  k.tags,
  k.category,
  k.source_url,
  k.confidence_score,
  k.created_at,
  k.updated_at,
  rank
FROM knowledge k
INNER JOIN knowledge_fts fts ON k.id = fts.rowid
WHERE k.is_active = 1;

-- ============================================
-- Optimize FTS Index
-- ============================================

-- Optimize the FTS index for better performance
INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize');


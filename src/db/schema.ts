/**
 * Database Schema Definitions
 * Drizzle ORM schema for Cloudflare D1
 */

import { sql } from 'drizzle-orm';
import { 
  sqliteTable, 
  text, 
  integer, 
  real,
  primaryKey,
  unique,
  index,
} from 'drizzle-orm/sqlite-core';

/**
 * Participants table - Katılımcı bilgileri
 */
export const participants = sqliteTable('participants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').unique(),
  phone: text('phone'),
  consentMarketing: integer('consent_marketing', { mode: 'boolean' }).default(false).notNull(),
  consentTerms: integer('consent_terms', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    emailIdx: index('idx_participants_email').on(table.email),
    createdAtIdx: index('idx_participants_created_at').on(table.createdAt),
  };
});

/**
 * Admin users table - Admin kullanıcıları
 */
export const adminUsers = sqliteTable('admin_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'super_admin'] }).default('admin').notNull(),
  permissions: text('permissions'), // JSON array
  isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    usernameIdx: index('idx_admin_users_username').on(table.username),
    emailIdx: index('idx_admin_users_email').on(table.email),
    roleIdx: index('idx_admin_users_role').on(table.role),
  };
});

/**
 * Quiz sessions table - Yarışma oturumları
 * Includes lastActivityAt for deterministic ranking on ties
 */
export const quizSessions = sqliteTable('quiz_sessions', {
  id: text('id').primaryKey(), // UUID
  participantId: integer('participant_id').notNull().references(() => participants.id),
  status: text('status', { 
    enum: ['active', 'completed', 'paused', 'abandoned'] 
  }).notNull(),
  totalScore: integer('total_score').default(0).notNull(),
  currentQuestionIndex: integer('current_question_index').default(0).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  lastActivityAt: integer('last_activity_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(), // For deterministic ordering
}, (table) => {
  return {
    participantStartedAtUnique: unique().on(table.participantId, table.startedAt),
    statusIdx: index('idx_quiz_sessions_status').on(table.status),
    participantIdx: index('idx_quiz_sessions_participant').on(table.participantId),
    // Deterministic leaderboard index
    leaderboardIdx: index('idx_leaderboard_deterministic').on(
      table.status, 
      table.totalScore, 
      table.completedAt, 
      table.lastActivityAt
    ).where(sql`status = 'completed'`),
  };
});

/**
 * Questions table - Sorular
 */
export const questions = sqliteTable('questions', {
  id: text('id').primaryKey(), // UUID
  orderNo: integer('order_no').notNull().unique(),
  text: text('text').notNull(),
  correctAnswer: text('correct_answer').notNull(),
  options: text('options'), // JSON array for multiple choice
  difficulty: integer('difficulty').notNull().default(1), // 1-5
  basePoints: integer('base_points').default(10).notNull(),
  timeLimit: integer('time_limit').default(30).notNull(), // seconds
  category: text('category').default('zero_waste').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    orderIdx: index('idx_questions_order').on(table.orderNo),
    categoryIdx: index('idx_questions_category').on(table.category),
    difficultyIdx: index('idx_questions_difficulty').on(table.difficulty),
    activeIdx: index('idx_questions_active').on(table.isActive),
  };
});

/**
 * Session questions table - Oturum soruları (many-to-many)
 */
export const sessionQuestions = sqliteTable('session_questions', {
  id: text('id').primaryKey(), // UUID
  sessionId: text('session_id').notNull().references(() => quizSessions.id),
  questionId: text('question_id').notNull().references(() => questions.id),
  orderInSession: integer('order_in_session').notNull(),
  isAnswered: integer('is_answered', { mode: 'boolean' }).default(false).notNull(),
  userAnswer: text('user_answer'),
  isCorrect: integer('is_correct', { mode: 'boolean' }),
  pointsEarned: integer('points_earned').default(0).notNull(),
  responseTime: integer('response_time'), // milliseconds
  presentedAt: integer('presented_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  answeredAt: integer('answered_at', { mode: 'timestamp' }),
}, (table) => {
  return {
    sessionQuestionUnique: unique().on(table.sessionId, table.questionId),
    sessionOrderUnique: unique().on(table.sessionId, table.orderInSession),
    sessionIdx: index('idx_session_questions_session').on(table.sessionId),
    answeredIdx: index('idx_session_questions_answered').on(table.answeredAt),
    // Covering index for performance
    coveringIdx: index('idx_session_questions_covering').on(
      table.sessionId,
      table.orderInSession,
      table.answeredAt,
      table.isCorrect,
      table.pointsEarned
    ),
  };
});

/**
 * Question timings table - Server-authoritative timing (CRITICAL)
 * Tracks 4 timing events: tts_start, tts_end, speech_start, answer_received
 */
export const questionTimings = sqliteTable('question_timings', {
  id: text('id').primaryKey(), // UUID
  sessionQuestionId: text('session_question_id').notNull()
    .references(() => sessionQuestions.id),
  eventType: text('event_type', { 
    enum: ['tts_start', 'tts_end', 'speech_start', 'answer_received'] 
  }).notNull(),
  serverTimestamp: integer('server_timestamp').notNull(), // Monotonic server time
  clientSignalTimestamp: integer('client_signal_timestamp'), // Client time (reference)
  networkLatency: integer('network_latency'), // Calculated network latency (ms)
  metadata: text('metadata'), // JSON for additional data (transcript, confidence, etc.)
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    sessionEventUnique: unique().on(table.sessionQuestionId, table.eventType),
    sessionQuestionIdx: index('idx_question_timings_session_question').on(table.sessionQuestionId),
    eventTypeIdx: index('idx_question_timings_event_type').on(table.eventType),
    serverTimestampIdx: index('idx_question_timings_server_timestamp').on(table.serverTimestamp),
    // Partial index for active queries (last 24 hours)
    activeIdx: index('idx_question_timings_active').on(
      table.sessionQuestionId,
      table.eventType,
      table.serverTimestamp
    ).where(sql`server_timestamp > (unixepoch() - 86400)`),
  };
});

/**
 * Knowledge base table - Bilgi bankası
 */
export const knowledge = sqliteTable('knowledge', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  tags: text('tags'), // Comma-separated tags
  category: text('category').default('zero_waste').notNull(),
  sourceUrl: text('source_url'),
  confidenceScore: real('confidence_score').default(1.0).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    categoryIdx: index('idx_knowledge_category').on(table.category),
    activeIdx: index('idx_knowledge_active').on(table.isActive),
  };
});

/**
 * Audit logs table - KVKK compliance
 */
export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  action: text('action', { 
    enum: ['INSERT', 'UPDATE', 'DELETE', 'SELECT'] 
  }).notNull(),
  oldValues: text('old_values'), // JSON
  newValues: text('new_values'), // JSON
  adminUserId: integer('admin_user_id').references(() => adminUsers.id),
  participantId: integer('participant_id').references(() => participants.id),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  sessionId: text('session_id'),
  privacyImpact: text('privacy_impact'), // KVKK data processing category
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    tableRecordIdx: index('idx_audit_logs_table_record').on(table.tableName, table.recordId),
    adminUserIdx: index('idx_audit_logs_admin_user').on(table.adminUserId),
    participantIdx: index('idx_audit_logs_participant').on(table.participantId),
    createdAtIdx: index('idx_audit_logs_created_at').on(table.createdAt),
    privacyImpactIdx: index('idx_audit_logs_privacy_impact').on(table.privacyImpact),
  };
});

/**
 * Data processing activities table - KVKK veri işleme
 */
export const dataProcessingActivities = sqliteTable('data_processing_activities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  participantId: integer('participant_id').references(() => participants.id),
  activityType: text('activity_type', { 
    enum: ['registration', 'quiz_participation', 'audio_processing', 
           'score_calculation', 'leaderboard_display', 'data_export'] 
  }).notNull(),
  dataCategories: text('data_categories'), // JSON array
  processingPurpose: text('processing_purpose').notNull(),
  legalBasis: text('legal_basis').notNull(), // KVKK legal basis
  retentionPeriod: integer('retention_period'), // Days
  isAutomated: integer('is_automated', { mode: 'boolean' }).default(true).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    participantIdx: index('idx_data_processing_participant').on(table.participantId),
    activityTypeIdx: index('idx_data_processing_type').on(table.activityType),
    createdAtIdx: index('idx_data_processing_created_at').on(table.createdAt),
  };
});

/**
 * Consent records table - Rıza yönetimi
 */
export const consentRecords = sqliteTable('consent_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  participantId: integer('participant_id').notNull().references(() => participants.id),
  consentType: text('consent_type', { 
    enum: ['terms_of_service', 'privacy_policy', 'marketing_communications',
           'audio_processing', 'data_sharing', 'analytics'] 
  }).notNull(),
  consentGiven: integer('consent_given', { mode: 'boolean' }).notNull(),
  consentVersion: text('consent_version').notNull(), // Policy version
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  withdrawalDate: integer('withdrawal_date', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    participantIdx: index('idx_consent_records_participant').on(table.participantId),
    consentTypeIdx: index('idx_consent_records_type').on(table.consentType),
    createdAtIdx: index('idx_consent_records_created_at').on(table.createdAt),
  };
});

/**
 * System settings table - Sistem ayarları
 */
export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  category: text('category').default('general').notNull(),
  isEnvironmentVariable: integer('is_environment_variable', { mode: 'boolean' }).default(false).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => {
  return {
    categoryIdx: index('idx_system_settings_category').on(table.category),
  };
});

// Export all tables for easy access
export const schema = {
  participants,
  adminUsers,
  quizSessions,
  questions,
  sessionQuestions,
  questionTimings,
  knowledge,
  auditLogs,
  dataProcessingActivities,
  consentRecords,
  systemSettings,
};

// Type exports for use in application
export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;

export type QuizSession = typeof quizSessions.$inferSelect;
export type NewQuizSession = typeof quizSessions.$inferInsert;

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;

export type SessionQuestion = typeof sessionQuestions.$inferSelect;
export type NewSessionQuestion = typeof sessionQuestions.$inferInsert;

export type QuestionTiming = typeof questionTimings.$inferSelect;
export type NewQuestionTiming = typeof questionTimings.$inferInsert;

export type Knowledge = typeof knowledge.$inferSelect;
export type NewKnowledge = typeof knowledge.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type DataProcessingActivity = typeof dataProcessingActivities.$inferSelect;
export type NewDataProcessingActivity = typeof dataProcessingActivities.$inferInsert;

export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;


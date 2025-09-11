/**
 * Database Entity Type Definitions
 * Types for database tables and relations
 */

/**
 * Participant entity
 */
export interface Participant {
  /** Auto-increment ID */
  id: number;
  
  /** Participant's full name */
  name: string;
  
  /** Email address (optional) */
  email?: string;
  
  /** Phone number (optional) */
  phone?: string;
  
  /** Marketing consent flag */
  consentMarketing: boolean;
  
  /** Terms of service consent flag */
  consentTerms: boolean;
  
  /** Creation timestamp */
  createdAt: Date;
  
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Admin user entity
 */
export interface AdminUser {
  /** Auto-increment ID */
  id: number;
  
  /** Unique username */
  username: string;
  
  /** Email address */
  email: string;
  
  /** Bcrypt password hash */
  passwordHash: string;
  
  /** Admin role */
  role: 'admin' | 'super_admin';
  
  /** JSON array of permissions */
  permissions: string[];
  
  /** Active status */
  isActive: boolean;
  
  /** Last login timestamp */
  lastLoginAt?: Date;
  
  /** Creation timestamp */
  createdAt: Date;
  
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Question entity (from database)
 */
export interface QuestionEntity {
  /** UUID */
  id: string;
  
  /** Display order */
  orderNo: number;
  
  /** Question text */
  text: string;
  
  /** Correct answer */
  correctAnswer: string;
  
  /** JSON array of options */
  options?: string;
  
  /** Difficulty (1-5) */
  difficulty: number;
  
  /** Base points */
  basePoints: number;
  
  /** Time limit in seconds */
  timeLimit: number;
  
  /** Category */
  category: string;
  
  /** Active status */
  isActive: boolean;
  
  /** Creation timestamp */
  createdAt: Date;
  
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Quiz session entity
 */
export interface QuizSessionEntity {
  /** UUID */
  id: string;
  
  /** Participant ID reference */
  participantId: number;
  
  /** Session status */
  status: string;
  
  /** Total score */
  totalScore: number;
  
  /** Current question index */
  currentQuestionIndex: number;
  
  /** Unix timestamp - started at */
  startedAt: number;
  
  /** Unix timestamp - completed at */
  completedAt?: number;
  
  /** Unix timestamp - last activity */
  lastActivityAt: number;
}

/**
 * Session question entity
 */
export interface SessionQuestionEntity {
  /** UUID */
  id: string;
  
  /** Session ID reference */
  sessionId: string;
  
  /** Question ID reference */
  questionId: string;
  
  /** Order in session */
  orderInSession: number;
  
  /** Answer status */
  isAnswered: boolean;
  
  /** User's answer */
  userAnswer?: string;
  
  /** Correctness */
  isCorrect?: boolean;
  
  /** Points earned */
  pointsEarned: number;
  
  /** Response time in ms */
  responseTime?: number;
  
  /** Unix timestamp - presented */
  presentedAt: number;
  
  /** Unix timestamp - answered */
  answeredAt?: number;
}

/**
 * Timing record for server-authoritative timing
 */
export interface QuestionTiming {
  /** UUID */
  id: string;
  
  /** Session question ID reference */
  sessionQuestionId: string;
  
  /** Event type */
  eventType: 'tts_start' | 'tts_end' | 'speech_start' | 'answer_received';
  
  /** Server timestamp (monotonic) */
  serverTimestamp: number;
  
  /** Client signal timestamp (for latency calc) */
  clientSignalTimestamp?: number;
  
  /** Calculated network latency in ms */
  networkLatency?: number;
  
  /** JSON metadata (transcript, confidence, etc) */
  metadata?: string;
  
  /** Unix timestamp - created */
  createdAt: number;
}

/**
 * Audit log entry
 */
export interface AuditLog {
  /** Auto-increment ID */
  id: number;
  
  /** Table name */
  tableName: string;
  
  /** Record ID */
  recordId: string;
  
  /** Action type */
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'SELECT';
  
  /** JSON - old values */
  oldValues?: string;
  
  /** JSON - new values */
  newValues?: string;
  
  /** Admin user ID (if admin action) */
  adminUserId?: number;
  
  /** Participant ID (if user action) */
  participantId?: number;
  
  /** IP address */
  ipAddress?: string;
  
  /** User agent string */
  userAgent?: string;
  
  /** Session ID */
  sessionId?: string;
  
  /** Privacy impact category */
  privacyImpact?: string;
  
  /** Unix timestamp - created */
  createdAt: number;
}

/**
 * Data processing activity (KVKK/GDPR)
 */
export interface DataProcessingActivity {
  /** Auto-increment ID */
  id: number;
  
  /** Participant ID reference */
  participantId: number;
  
  /** Activity type */
  activityType: 
    | 'registration' 
    | 'quiz_participation' 
    | 'audio_processing'
    | 'score_calculation' 
    | 'leaderboard_display' 
    | 'data_export';
  
  /** JSON array of data categories */
  dataCategories: string;
  
  /** Processing purpose */
  processingPurpose: string;
  
  /** Legal basis (KVKK) */
  legalBasis: string;
  
  /** Retention period in days */
  retentionPeriod: number;
  
  /** Automated processing flag */
  isAutomated: boolean;
  
  /** Unix timestamp - created */
  createdAt: number;
}

/**
 * Consent record
 */
export interface ConsentRecord {
  /** Auto-increment ID */
  id: number;
  
  /** Participant ID reference */
  participantId: number;
  
  /** Consent type */
  consentType: 
    | 'terms_of_service' 
    | 'privacy_policy' 
    | 'marketing_communications'
    | 'audio_processing' 
    | 'data_sharing' 
    | 'analytics';
  
  /** Consent given flag */
  consentGiven: boolean;
  
  /** Policy version consented to */
  consentVersion: string;
  
  /** IP address */
  ipAddress?: string;
  
  /** User agent */
  userAgent?: string;
  
  /** Unix timestamp - withdrawal date */
  withdrawalDate?: number;
  
  /** Unix timestamp - created */
  createdAt: number;
}

/**
 * System settings
 */
export interface SystemSetting {
  /** Setting key (primary key) */
  key: string;
  
  /** Setting value */
  value: string;
  
  /** Description */
  description?: string;
  
  /** Category */
  category: string;
  
  /** Is from environment variable */
  isEnvironmentVariable: boolean;
  
  /** Unix timestamp - updated */
  updatedAt: number;
}

/**
 * Session state (for Durable Objects)
 */
export interface SessionState {
  /** Session ID */
  sessionId: string;
  
  /** Participant ID */
  participantId: number;
  
  /** Current status */
  status: string;
  
  /** Current question index */
  currentQuestionIndex: number;
  
  /** Total score */
  totalScore: number;
  
  /** Questions answered */
  questionsAnswered: number;
  
  /** Last update timestamp */
  lastUpdate: number;
  
  /** WebSocket client IDs */
  connectedClients: string[];
}

/**
 * Leaderboard entry (materialized view)
 */
export interface LeaderboardEntry {
  /** Participant ID */
  participantId: number;
  
  /** Participant name */
  name: string;
  
  /** Total score */
  totalScore: number;
  
  /** Completion timestamp */
  completedAt: number;
  
  /** Last activity timestamp */
  lastActivityAt: number;
  
  /** Number of correct answers */
  correctAnswers: number;
  
  /** Total questions answered */
  totalQuestions: number;
  
  /** Average response time in ms */
  avgResponseTime: number;
  
  /** Rank (calculated) */
  rank?: number;
}

/**
 * Token blacklist entry
 */
export interface TokenBlacklist {
  /** Token hash */
  tokenHash: string;
  
  /** Revocation reason */
  reason: string;
  
  /** Expiry timestamp */
  expiresAt: number;
  
  /** Unix timestamp - created */
  createdAt: number;
}

/**
 * Rate limit entry
 */
export interface RateLimitEntry {
  /** Identifier (IP, user ID, etc) */
  identifier: string;
  
  /** Endpoint or action */
  endpoint: string;
  
  /** Request count */
  count: number;
  
  /** Window start timestamp */
  windowStart: number;
  
  /** Last request timestamp */
  lastRequest: number;
}

/**
 * Database query result wrapper
 */
export interface QueryResult<T> {
  /** Result rows */
  rows: T[];
  
  /** Rows affected (for mutations) */
  rowsAffected?: number;
  
  /** Last insert ID (if applicable) */
  lastInsertId?: number | string;
  
  /** Query execution time in ms */
  duration?: number;
}

/**
 * Database transaction interface
 */
export interface Transaction {
  /** Execute a query in transaction */
  execute<T>(query: string, params?: any[]): Promise<QueryResult<T>>;
  
  /** Commit the transaction */
  commit(): Promise<void>;
  
  /** Rollback the transaction */
  rollback(): Promise<void>;
}

/**
 * Migration record
 */
export interface Migration {
  /** Migration ID */
  id: number;
  
  /** Migration name */
  name: string;
  
  /** Applied timestamp */
  appliedAt: number;
  
  /** Checksum */
  checksum: string;
}


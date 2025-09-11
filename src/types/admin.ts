/**
 * Admin Panel Type Definitions
 * Types for admin functionality and management
 */

/**
 * Admin user roles
 */
export type AdminRole = 'admin' | 'super_admin';

/**
 * Admin permissions
 */
export enum AdminPermission {
  // Question management
  QUESTION_VIEW = 'question:view',
  QUESTION_CREATE = 'question:create',
  QUESTION_UPDATE = 'question:update',
  QUESTION_DELETE = 'question:delete',
  
  // User management
  USER_VIEW = 'user:view',
  USER_BAN = 'user:ban',
  USER_DELETE = 'user:delete',
  USER_EXPORT = 'user:export',
  
  // System management
  SYSTEM_CONFIG = 'system:config',
  SYSTEM_LOGS = 'system:logs',
  SYSTEM_STATS = 'system:stats',
  
  // Data management
  DATA_EXPORT = 'data:export',
  DATA_IMPORT = 'data:import',
  DATA_CLEANUP = 'data:cleanup',
  
  // Admin management (super admin only)
  ADMIN_CREATE = 'admin:create',
  ADMIN_UPDATE = 'admin:update',
  ADMIN_DELETE = 'admin:delete',
}

/**
 * Admin user interface
 */
export interface AdminUser {
  /** Unique ID */
  id: number;
  
  /** Username for login */
  username: string;
  
  /** Email address */
  email: string;
  
  /** Admin role */
  role: AdminRole;
  
  /** Array of permissions */
  permissions: AdminPermission[];
  
  /** Active status */
  isActive: boolean;
  
  /** Last login timestamp */
  lastLoginAt?: Date;
  
  /** Account creation timestamp */
  createdAt: Date;
}

/**
 * Admin login request
 */
export interface AdminLoginRequest {
  /** Username or email */
  username: string;
  
  /** Password (plain text - will be hashed) */
  password: string;
  
  /** Remember me flag for extended session */
  rememberMe?: boolean;
}

/**
 * Admin login response
 */
export interface AdminLoginResponse {
  /** Admin user info */
  admin: AdminUser;
  
  /** JWT token */
  token: string;
  
  /** Token expiration */
  expiresAt: string;
  
  /** Refresh token (if remember me) */
  refreshToken?: string;
}

/**
 * Admin session info
 */
export interface AdminSession {
  /** Admin user ID */
  adminId: number;
  
  /** Username */
  username: string;
  
  /** Role */
  role: AdminRole;
  
  /** Permissions */
  permissions: AdminPermission[];
  
  /** Session start time */
  startedAt: Date;
  
  /** Last activity time */
  lastActivityAt: Date;
  
  /** IP address */
  ipAddress: string;
  
  /** User agent */
  userAgent: string;
}

/**
 * Question management operations
 */
export type QuestionAction = 'create' | 'update' | 'delete' | 'activate' | 'deactivate';

/**
 * Question create request
 */
export interface QuestionCreateRequest {
  /** Question text */
  text: string;
  
  /** Correct answer */
  correctAnswer: string;
  
  /** Optional multiple choice options */
  options?: string[];
  
  /** Difficulty level (1-5) */
  difficulty: number;
  
  /** Base points */
  basePoints: number;
  
  /** Time limit in seconds */
  timeLimit: number;
  
  /** Category */
  category: string;
  
  /** Order number */
  orderNo: number;
  
  /** Active status */
  isActive?: boolean;
}

/**
 * Question update request
 */
export interface QuestionUpdateRequest {
  /** Question text */
  text?: string;
  
  /** Correct answer */
  correctAnswer?: string;
  
  /** Multiple choice options */
  options?: string[];
  
  /** Difficulty level */
  difficulty?: number;
  
  /** Base points */
  basePoints?: number;
  
  /** Time limit */
  timeLimit?: number;
  
  /** Category */
  category?: string;
  
  /** Order number */
  orderNo?: number;
  
  /** Active status */
  isActive?: boolean;
}

/**
 * Question filters for listing
 */
export interface QuestionFilters {
  /** Filter by category */
  category?: string;
  
  /** Filter by difficulty */
  difficulty?: number;
  
  /** Filter by active status */
  isActive?: boolean;
  
  /** Search in text */
  searchText?: string;
  
  /** Sort by field */
  sortBy?: 'orderNo' | 'difficulty' | 'createdAt' | 'updatedAt';
  
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  
  /** Page number */
  page?: number;
  
  /** Page size */
  pageSize?: number;
}

/**
 * Question list result
 */
export interface QuestionListResult {
  /** Question items */
  questions: QuestionAdminView[];
  
  /** Total count */
  total: number;
  
  /** Current page */
  page: number;
  
  /** Page size */
  pageSize: number;
  
  /** Total pages */
  totalPages: number;
}

/**
 * Question view for admin (includes metadata)
 */
export interface QuestionAdminView {
  /** Question ID */
  id: string;
  
  /** All question fields */
  text: string;
  correctAnswer: string;
  options?: string[];
  difficulty: number;
  basePoints: number;
  timeLimit: number;
  category: string;
  orderNo: number;
  isActive: boolean;
  
  /** Metadata */
  createdAt: Date;
  updatedAt: Date;
  
  /** Usage statistics */
  stats?: {
    timesUsed: number;
    avgResponseTime: number;
    correctRate: number;
    lastUsed?: Date;
  };
}

/**
 * User management operations
 */
export type UserAction = 'ban' | 'unban' | 'delete_data' | 'export_data';

/**
 * User management request
 */
export interface UserActionRequest {
  /** User ID */
  userId: number;
  
  /** Action to perform */
  action: UserAction;
  
  /** Reason for action */
  reason: string;
  
  /** Additional options */
  options?: {
    /** For delete_data: what to delete */
    deleteScope?: 'all' | 'personal' | 'activity';
    
    /** For export_data: format */
    exportFormat?: 'json' | 'csv' | 'pdf';
    
    /** For ban: duration in days (0 = permanent) */
    banDuration?: number;
  };
}

/**
 * User action result
 */
export interface UserActionResult {
  /** Success status */
  success: boolean;
  
  /** Action performed */
  action: UserAction;
  
  /** Affected user ID */
  userId: number;
  
  /** Result message */
  message: string;
  
  /** Additional data (e.g., export URL) */
  data?: any;
}

/**
 * Audit log filters
 */
export interface AuditFilters {
  /** Filter by table */
  tableName?: string;
  
  /** Filter by action */
  action?: 'INSERT' | 'UPDATE' | 'DELETE' | 'SELECT';
  
  /** Filter by admin user */
  adminUserId?: number;
  
  /** Filter by participant */
  participantId?: number;
  
  /** Date range start */
  startDate?: Date;
  
  /** Date range end */
  endDate?: Date;
  
  /** Privacy impact level */
  privacyImpact?: string;
  
  /** Page number */
  page?: number;
  
  /** Page size */
  pageSize?: number;
}

/**
 * Audit log result
 */
export interface AuditLogResult {
  /** Audit entries */
  entries: AuditLogEntry[];
  
  /** Total count */
  total: number;
  
  /** Summary statistics */
  summary: {
    byAction: Record<string, number>;
    byTable: Record<string, number>;
    byAdmin: Record<string, number>;
  };
}

/**
 * Audit log entry for display
 */
export interface AuditLogEntry {
  /** Entry ID */
  id: number;
  
  /** Table name */
  tableName: string;
  
  /** Record ID */
  recordId: string;
  
  /** Action performed */
  action: string;
  
  /** Who performed it */
  performer: {
    type: 'admin' | 'user' | 'system';
    id?: number;
    name?: string;
  };
  
  /** Changes made */
  changes?: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
  
  /** Metadata */
  metadata: {
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    privacyImpact?: string;
  };
  
  /** Timestamp */
  createdAt: Date;
}

/**
 * System statistics
 */
export interface SystemStats {
  /** User statistics */
  users: {
    total: number;
    active: number;
    new24h: number;
    new7d: number;
  };
  
  /** Quiz statistics */
  quizzes: {
    totalSessions: number;
    completedSessions: number;
    averageScore: number;
    totalQuestions: number;
  };
  
  /** Performance metrics */
  performance: {
    avgResponseTime: number;
    successRate: number;
    errorRate: number;
    activeConnections: number;
  };
  
  /** Storage usage */
  storage: {
    databaseSize: number;
    audioStorageUsed: number;
    cacheSize: number;
    logsSize: number;
  };
  
  /** System health */
  health: {
    cpuUsage: number;
    memoryUsage: number;
    uptime: number;
    lastError?: Date;
  };
}

/**
 * Bulk operation request
 */
export interface BulkOperationRequest {
  /** Operation type */
  operation: 'delete' | 'update' | 'export';
  
  /** Target entity type */
  entityType: 'questions' | 'users' | 'sessions';
  
  /** Entity IDs */
  ids: string[] | number[];
  
  /** Update data (for update operation) */
  updateData?: any;
  
  /** Options */
  options?: {
    dryRun?: boolean;
    notifyUsers?: boolean;
    createBackup?: boolean;
  };
}

/**
 * Bulk operation result
 */
export interface BulkOperationResult {
  /** Operation performed */
  operation: string;
  
  /** Total items processed */
  totalProcessed: number;
  
  /** Successful items */
  successful: number;
  
  /** Failed items */
  failed: number;
  
  /** Error details */
  errors?: Array<{
    id: string | number;
    error: string;
  }>;
  
  /** Operation duration in ms */
  duration: number;
}

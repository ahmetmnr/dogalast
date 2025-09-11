/**
 * API Request/Response Type Definitions
 * Base types for all API communications
 */

import { Context } from 'hono'
import type { DatabaseInstance } from '@/db/connection'

// Hono Context Variables interface
export interface ContextVariables {
  user?: UserContext
  db: DatabaseInstance
  validatedBody?: any
  validatedQuery?: any
  validatedParams?: any
}

// Extend Hono Context with our variables
export type AppContext = Context<{
  Variables: ContextVariables
}>

// User context interface
export interface UserContext {
  id: string
  name: string
  email?: string
  role: 'user' | 'admin' | 'super_admin'
  permissions: string[]
  sessionId?: string
}

// Tool dispatch request interface
export interface ToolDispatchRequest {
  tool: string
  args: Record<string, any>
  sessionId?: string
  idempotencyKey?: string
}

// Leaderboard query interface
export interface LeaderboardQuery {
  limit: number
  offset: number
  period: 'all' | 'today' | 'week' | 'month'
}

export interface ToolExecutionResult {
  success: boolean
  result?: any
  error?: {
    code: string
    message: string
  }
  timing: {
    serverTimestamp: number
    processingTime: number
  }
}

/**
 * Base API response structure
 * @template T The type of the data payload
 */
export interface ApiResponse<T = any> {
  /** Indicates if the request was successful */
  success: boolean;
  
  /** Response data payload (only present on success) */
  data?: T;
  
  /** Error information (only present on failure) */
  error?: ApiError;
  
  /** Timing information */
  timing?: {
    serverTimestamp: number;
    processingTime: number;
  };
  
  /** ISO timestamp of the response */
  timestamp: string;
}

/**
 * Standard API error structure
 */
export interface ApiError {
  /** Machine-readable error code */
  code: string;
  
  /** Human-readable error message */
  message: string;
  
  /** Request ID for tracking */
  requestId?: string;
  
  /** Additional error context */
  details?: Record<string, any>;
}

/**
 * Registration request payload
 */
export interface RegisterRequest {
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
}

/**
 * Registration response payload
 */
export interface RegisterResponse {
  /** Participant ID */
  participantId: number;
  
  /** Session ID for the quiz */
  sessionId: string;
  
  /** JWT token for authentication */
  token: string;
  
  /** Token expiration time */
  expiresAt: string;
}

/**
 * Tool dispatch request for OpenAI function calling
 */
export interface ToolRequest {
  /** Tool name to execute */
  tool: string;
  
  /** Tool arguments */
  args: Record<string, any>;
  
  /** Session ID (optional) */
  sessionId?: string;
  
  /** JWT token (optional) */
  jwt?: string;
}

/**
 * Tool dispatch response
 */
export interface ToolResponse {
  /** Tool execution result */
  result: any;
  
  /** Execution time in milliseconds */
  executionTime: number;
  
  /** Tool name that was executed */
  tool: string;
}

/**
 * Ephemeral token request
 */
export interface EphemeralTokenRequest {
  /** Current session ID */
  sessionId: string;
}

/**
 * Ephemeral token response
 */
export interface EphemeralTokenResponse {
  /** OpenAI client secret */
  clientSecret: string;
  
  /** Token expiration timestamp */
  expiresAt: string;
  
  /** Refresh threshold timestamp */
  refreshThreshold: string;
}

/**
 * Token refresh request
 */
export interface RefreshTokenRequest {
  /** Current session ID */
  sessionId: string;
  
  /** Current token to refresh */
  currentToken: string;
}

/**
 * Token refresh response
 */
export interface RefreshTokenResponse {
  /** New client secret */
  newClientSecret: string;
  
  /** New expiration timestamp */
  newExpiresAt: string;
  
  /** New refresh threshold */
  newRefreshThreshold: string;
}

/**
 * Session resume request
 */
export interface SessionResumeRequest {
  /** Session ID to resume */
  sessionId: string;
}

/**
 * Session resume response
 */
export interface SessionResumeResponse {
  /** Whether the session can be continued */
  canContinue: boolean;
  
  /** Current session state */
  sessionState: {
    questionIndex: number;
    totalScore: number;
    status: string;
  };
  
  /** Remaining time in seconds */
  remainingTime: number;
}

/**
 * Leaderboard request parameters
 */
export interface LeaderboardRequest {
  /** Number of entries to return */
  limit?: number;
  
  /** Offset for pagination */
  offset?: number;
  
  /** Time range filter */
  timeRange?: 'today' | 'week' | 'month' | 'all';
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  /** Rank position */
  rank: number;
  
  /** Participant name */
  name: string;
  
  /** Total score */
  score: number;
  
  /** Completion time */
  completedAt: string;
  
  /** Number of correct answers */
  correctAnswers: number;
  
  /** Average response time in seconds */
  avgResponseTime: number;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  /** Service status */
  status: 'healthy' | 'unhealthy';
  
  /** Check timestamp */
  timestamp: string;
  
  /** Service version */
  version: string;
  
  /** Environment name */
  environment: string;
  
  /** Individual service statuses */
  services: {
    database: 'connected' | 'disconnected';
    openai: 'available' | 'unavailable';
    durable_objects?: 'ready' | 'not_ready';
  };
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  /** Page number (1-based) */
  page?: number;
  
  /** Items per page */
  pageSize?: number;
  
  /** Sort field */
  sortBy?: string;
  
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  /** Data items */
  items: T[];
  
  /** Total number of items */
  total: number;
  
  /** Current page */
  page: number;
  
  /** Items per page */
  pageSize: number;
  
  /** Total number of pages */
  totalPages: number;
}

/**
 * WebSocket message types
 */
export enum WebSocketMessageType {
  LEADERBOARD_UPDATE = 'leaderboard_update',
  SESSION_UPDATE = 'session_update',
  QUESTION_START = 'question_start',
  ANSWER_RECEIVED = 'answer_received',
  QUIZ_COMPLETE = 'quiz_complete',
  ERROR = 'error',
  PING = 'ping',
  PONG = 'pong',
}

/**
 * WebSocket message structure
 */
export interface WebSocketMessage<T = any> {
  /** Message type */
  type: WebSocketMessageType;
  
  /** Message payload */
  payload: T;
  
  /** Message timestamp */
  timestamp: string;
  
  /** Optional message ID for acknowledgment */
  messageId?: string;
}

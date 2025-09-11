export enum ErrorCode {
  // Client Errors
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  
  // Authentication Errors
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_REFRESH_FAILED = 'TOKEN_REFRESH_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  
  // Session Errors
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_INVALID = 'SESSION_INVALID',
  SESSION_RESUME_FAILED = 'SESSION_RESUME_FAILED',
  SESSION_ALREADY_COMPLETED = 'SESSION_ALREADY_COMPLETED',
  
  // Quiz Errors
  QUIZ_NOT_FOUND = 'QUIZ_NOT_FOUND',
  QUIZ_ALREADY_STARTED = 'QUIZ_ALREADY_STARTED',
  QUIZ_NOT_STARTED = 'QUIZ_NOT_STARTED',
  QUIZ_COMPLETED = 'QUIZ_COMPLETED',
  QUESTION_NOT_FOUND = 'QUESTION_NOT_FOUND',
  INVALID_ANSWER = 'INVALID_ANSWER',
  
  // Tool Errors
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
  TOOL_UNAUTHORIZED = 'TOOL_UNAUTHORIZED',
  TOOL_RATE_LIMITED = 'TOOL_RATE_LIMITED',
  
  // Database Errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  RECORD_NOT_FOUND = 'RECORD_NOT_FOUND',
  DUPLICATE_RECORD = 'DUPLICATE_RECORD',
  CONSTRAINT_VIOLATION = 'CONSTRAINT_VIOLATION',
  
  // Validation Errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  
  // OpenAI Errors
  OPENAI_API_ERROR = 'OPENAI_API_ERROR',
  OPENAI_RATE_LIMITED = 'OPENAI_RATE_LIMITED',
  OPENAI_INVALID_REQUEST = 'OPENAI_INVALID_REQUEST',
  
  // Privacy & KVKK
  PRIVACY_VIOLATION = 'PRIVACY_VIOLATION',
  DATA_RETENTION_ERROR = 'DATA_RETENTION_ERROR',
  CONSENT_REQUIRED = 'CONSENT_REQUIRED',
  
  // General Errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly details?: any

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    details?: any
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details
    }
  }
}

// Error factory functions
export function createAuthError(message: string, details?: any): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, message, 401, details)
}

export function createValidationError(message: string, details?: any): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, message, 400, details)
}

export function createNotFoundError(message: string, details?: any): AppError {
  return new AppError(ErrorCode.RECORD_NOT_FOUND, message, 404, details)
}

export function createRateLimitError(message: string, details?: any): AppError {
  return new AppError(ErrorCode.RATE_LIMIT_EXCEEDED, message, 429, details)
}

export function createInternalError(message: string, details?: any): AppError {
  return new AppError(ErrorCode.INTERNAL_SERVER_ERROR, message, 500, details)
}

/**
 * Error Handling Middleware
 * Centralized error processing and response formatting
 */

import { Context, Next } from 'hono';
import { BaseMiddleware } from './BaseMiddleware';
import type { Env } from '@/index';
import { Logger } from '@/utils/logger';
import type { ApiError, ApiResponse } from '@/types/api';

/**
 * Custom error types
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public code: string = 'VALIDATION_ERROR',
    public details?: any
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  constructor(
    message: string = 'Authentication required',
    public code: string = 'AUTH_ERROR'
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(
    message: string = 'Insufficient permissions',
    public code: string = 'FORBIDDEN'
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends Error {
  constructor(
    message: string = 'Resource not found',
    public code: string = 'NOT_FOUND'
  ) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string = 'Too many requests',
    public code: string = 'RATE_LIMIT_EXCEEDED',
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class DatabaseError extends Error {
  constructor(
    message: string = 'Database operation failed',
    public code: string = 'DATABASE_ERROR',
    public originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ExternalServiceError extends Error {
  constructor(
    message: string = 'External service error',
    public code: string = 'EXTERNAL_SERVICE_ERROR',
    public service?: string
  ) {
    super(message);
    this.name = 'ExternalServiceError';
  }
}

/**
 * Error response structure
 */
interface ErrorResponse extends ApiResponse {
  success: false;
  error: ApiError;
  timestamp: string;
}

/**
 * Error handling middleware
 */
export class ErrorHandlingMiddleware extends BaseMiddleware {
  /**
   * Error code to HTTP status mapping
   */
  private static readonly ERROR_STATUS_MAP: Record<string, number> = {
    VALIDATION_ERROR: 400,
    AUTH_ERROR: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    RATE_LIMIT_EXCEEDED: 429,
    DATABASE_ERROR: 500,
    EXTERNAL_SERVICE_ERROR: 502,
    INTERNAL_ERROR: 500,
  };

  /**
   * Handle middleware
   * @param c Hono context
   * @param next Next middleware
   */
  async handle(c: Context<{ Bindings: Env }>, next: Next): Promise<Response> {
    try {
      await next();
      
      // Handle 404 for unmatched routes
      if (c.res.status === 404 && !c.res.body) {
        throw new NotFoundError('The requested endpoint was not found');
      }
      
      return c.res;
    } catch (error) {
      return this.handleError(error as Error, c);
    }
  }

  /**
   * Handle different error types
   * @param error Error object
   * @param c Hono context
   * @returns Error response
   */
  protected handleError(error: Error, c: Context): Response {
    const requestId = this.getRequestId(c);
    const isDevelopment = this.getEnvValue(c, 'ENVIRONMENT') === 'development';

    // Log the error
    this.logError(error, {
      requestId,
      path: c.req.path,
      method: c.req.method,
      userId: c.get('user')?.id,
      sessionId: c.get('sessionId'),
    });

    // Determine error response based on error type
    let errorResponse: ErrorResponse;

    if (error instanceof ValidationError) {
      errorResponse = this.handleValidationError(error, requestId);
    } else if (error instanceof AuthenticationError) {
      errorResponse = this.handleAuthenticationError(error, requestId);
    } else if (error instanceof AuthorizationError) {
      errorResponse = this.handleAuthorizationError(error, requestId);
    } else if (error instanceof NotFoundError) {
      errorResponse = this.handleNotFoundError(error, requestId);
    } else if (error instanceof RateLimitError) {
      errorResponse = this.handleRateLimitError(error, requestId, c);
    } else if (error instanceof DatabaseError) {
      errorResponse = this.handleDatabaseError(error, requestId, isDevelopment);
    } else if (error instanceof ExternalServiceError) {
      errorResponse = this.handleExternalServiceError(error, requestId, isDevelopment);
    } else {
      errorResponse = this.handleGenericError(error, requestId, isDevelopment);
    }

    // Set appropriate status code
    const statusCode = this.getStatusCode(errorResponse.error.code);
    
    // Set error response headers
    this.setErrorHeaders(c, error);

    return c.json(errorResponse, statusCode);
  }

  /**
   * Handle validation errors
   */
  private handleValidationError(error: ValidationError, requestId: string): ErrorResponse {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle authentication errors
   */
  private handleAuthenticationError(error: AuthenticationError, requestId: string): ErrorResponse {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: {
          requestId,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle authorization errors
   */
  private handleAuthorizationError(error: AuthorizationError, requestId: string): ErrorResponse {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: {
          requestId,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle not found errors
   */
  private handleNotFoundError(error: NotFoundError, requestId: string): ErrorResponse {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: {
          requestId,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle rate limit errors
   */
  private handleRateLimitError(error: RateLimitError, requestId: string, c: Context): ErrorResponse {
    // Set retry-after header
    if ((error as any).retryAfter) {
      c.header('Retry-After', String((error as any).retryAfter));
    }

    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: {
          requestId,
          retryAfter: (error as any).retryAfter,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle database errors
   */
  private handleDatabaseError(error: DatabaseError, requestId: string, isDevelopment: boolean): ErrorResponse {
    return {
      success: false,
      error: {
        code: error.code,
        message: isDevelopment ? error.message : 'A database error occurred',
        details: isDevelopment ? {
          requestId,
          originalError: error.originalError?.message,
        } : {
          requestId,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle external service errors
   */
  private handleExternalServiceError(error: ExternalServiceError, requestId: string, isDevelopment: boolean): ErrorResponse {
    return {
      success: false,
      error: {
        code: error.code,
        message: isDevelopment ? error.message : 'An external service error occurred',
        details: {
          requestId,
          service: error.service,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handle generic errors
   */
  private handleGenericError(error: Error, requestId: string, isDevelopment: boolean): ErrorResponse {
    // Check for specific error patterns
    const errorCode = this.getErrorCode(error);
    const userMessage = this.getUserFriendlyMessage(error, isDevelopment);

    return {
      success: false,
      error: {
        code: errorCode,
        message: userMessage,
        details: isDevelopment ? {
          requestId,
          errorName: error.name,
          stack: error.stack,
        } : {
          requestId,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get error code from error
   */
  private getErrorCode(error: Error): string {
    // Check if error has a code property
    if ('code' in error && typeof error.code === 'string') {
      return error.code;
    }

    // Check error name
    if (error.name === 'SyntaxError') return 'INVALID_JSON';
    if (error.name === 'TypeError') return 'TYPE_ERROR';
    if (error.name === 'RangeError') return 'RANGE_ERROR';

    return 'INTERNAL_ERROR';
  }

  /**
   * Get user-friendly error message
   */
  private getUserFriendlyMessage(error: Error, isDevelopment: boolean): string {
    if (isDevelopment) {
      return error.message;
    }

    // Map technical errors to user-friendly messages
    const messageMap: Record<string, string> = {
      'INVALID_JSON': 'Invalid request format',
      'TYPE_ERROR': 'Invalid data type provided',
      'RANGE_ERROR': 'Value out of acceptable range',
      'ECONNREFUSED': 'Service temporarily unavailable',
      'ETIMEDOUT': 'Request timed out',
    };

    const code = this.getErrorCode(error);
    return messageMap[code] || 'An unexpected error occurred';
  }

  /**
   * Check if error should be logged
   */
  private shouldLogError(error: Error): boolean {
    // Don't log client errors in production
    if (error instanceof ValidationError || 
        error instanceof NotFoundError) {
      return this.getEnvValue({} as any, 'ENVIRONMENT') === 'development';
    }

    return true;
  }

  /**
   * Get HTTP status code for error
   */
  private getStatusCode(errorCode: string): number {
    return ErrorHandlingMiddleware.ERROR_STATUS_MAP[errorCode] || 500;
  }

  /**
   * Set error-specific headers
   */
  private setErrorHeaders(c: Context, error: Error): void {
    // Always include request ID
    const requestId = this.getRequestId(c);
    c.header('X-Request-ID', requestId);

    // Rate limit headers
    if (error instanceof RateLimitError && (error as any).retryAfter) {
      c.header('Retry-After', String((error as any).retryAfter));
      c.header('X-RateLimit-Limit', this.getEnvValue(c as any, 'RATE_LIMIT_REQUESTS_PER_MINUTE'));
      c.header('X-RateLimit-Remaining', '0');
    }

    // Cache headers for errors
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}

/**
 * Create error handling middleware instance
 */
export const errorHandling = () => {
  const middleware = new ErrorHandlingMiddleware();
  return middleware.create();
};

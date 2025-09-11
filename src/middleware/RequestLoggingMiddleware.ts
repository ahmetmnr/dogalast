/**
 * Request Logging Middleware
 * Structured logging for all HTTP requests and responses
 */

import { Context, Next } from 'hono';
import { BaseMiddleware } from './BaseMiddleware';
// Env type import removed - using any for now
import { Logger } from '@/utils/logger';

/**
 * Request log data structure
 */
export interface RequestLogData {
  /** Unique request ID */
  requestId: string;
  
  /** HTTP method */
  method: string;
  
  /** Request path */
  path: string;
  
  /** Query parameters */
  query?: Record<string, string>;
  
  /** User agent */
  userAgent: string;
  
  /** Client IP address */
  ipAddress: string;
  
  /** Request timestamp */
  timestamp: string;
  
  /** Request body size */
  requestSize?: number;
  
  /** Response time in milliseconds */
  duration?: number;
  
  /** HTTP status code */
  statusCode?: number;
  
  /** Response body size */
  responseSize?: number;
  
  /** Error details if request failed */
  error?: {
    code: string;
    message: string;
  };
  
  /** User ID if authenticated */
  userId?: number;
  
  /** Session ID if available */
  sessionId?: string;
}

/**
 * Request logging middleware
 */
export class RequestLoggingMiddleware extends BaseMiddleware {
  /**
   * Paths to exclude from logging
   */
  private static readonly EXCLUDED_PATHS = [
    '/health',
    '/metrics',
    '/favicon.ico',
  ];

  /**
   * Sensitive headers to mask
   */
  // Unused property removed
  // SENSITIVE_HEADERS removed

  /**
   * Handle middleware
   * @param c Hono context
   * @param next Next middleware
   */
  async handle(c: Context<{ Bindings: any }>, next: Next): Promise<void> {
    const startTime = performance.now();
    
    // Skip logging for excluded paths
    if (this.shouldSkipLogging(c)) {
      return next();
    }

    // Set request ID
    this.setRequestId(c);
    
    // Prepare request data
    const requestData = this.prepareRequestData(c);
    
    // Log request
    this.logRequest(requestData);

    try {
      // Process request
      await next();
      
      // Calculate duration
      const duration = performance.now() - startTime;
      
      // Get response data
      const responseData = await this.prepareResponseData(c, requestData, duration);
      
      // Log response
      this.logResponse(responseData);
      
    } catch (error) {
      // Calculate duration even on error
      const duration = performance.now() - startTime;
      
      // Log error response
      const errorData = this.prepareErrorData(c, requestData, duration, error as Error);
      this.logErrorResponse(errorData);
      
      // Re-throw to let error handler middleware handle it
      throw error;
    }
  }

  /**
   * Check if logging should be skipped for this request
   * @param c Hono context
   * @returns True if should skip
   */
  private shouldSkipLogging(c: Context): boolean {
    const path = c.req.path;
    return RequestLoggingMiddleware.EXCLUDED_PATHS.some(excluded => 
      path === excluded || path.startsWith(excluded + '/')
    );
  }

  /**
   * Prepare request data for logging
   * @param c Hono context
   * @returns Request log data
   */
  private prepareRequestData(c: Context): RequestLogData {
    const requestId = this.getRequestId(c);
    
    // Extract query parameters
    const url = new URL(c.req.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    // Get authenticated user info if available
    const user = c.get('user');
    const userId = user?.userId || user?.id;
    const sessionId = user?.sessionId || c.get('sessionId');

    return {
      requestId,
      method: c.req.method,
      path: c.req.path,
      query: Object.keys(query).length > 0 ? query : undefined,
      userAgent: this.getUserAgent(c),
      ipAddress: this.getClientIP(c),
      timestamp: new Date().toISOString(),
      requestSize: this.getRequestSize(c),
      userId,
      sessionId,
    };
  }

  /**
   * Prepare response data for logging
   * @param c Hono context
   * @param requestData Original request data
   * @param duration Request duration
   * @returns Response log data
   */
  private async prepareResponseData(
    c: Context,
    requestData: RequestLogData,
    duration: number
  ): Promise<RequestLogData> {
    const responseSize = await this.getResponseSize(c.res);
    
    return {
      ...requestData,
      duration: Math.round(duration * 100) / 100, // Round to 2 decimal places
      statusCode: c.res.status,
      responseSize,
    };
  }

  /**
   * Prepare error data for logging
   * @param c Hono context
   * @param requestData Original request data
   * @param duration Request duration
   * @param error Error object
   * @returns Error log data
   */
  private prepareErrorData(
    _c: Context,
    requestData: RequestLogData,
    duration: number,
    error: Error
  ): RequestLogData {
    return {
      ...requestData,
      duration: Math.round(duration * 100) / 100,
      statusCode: 500,
      error: {
        code: (error as any).code || 'INTERNAL_ERROR',
        message: error.message,
      },
    };
  }

  /**
   * Log incoming request
   * @param data Request log data
   */
  private logRequest(data: RequestLogData): void {
    const context: any = {
      requestId: data.requestId,
      method: data.method,
      path: data.path,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      userId: data.userId,
      sessionId: data.sessionId,
    };

    // Add query parameters if present
    if (data.query && Object.keys(data.query).length > 0) {
      context.query = this.sanitizeQueryParams(data.query);
    }

    Logger.info(`→ ${data.method} ${data.path}`, context);
  }

  /**
   * Log outgoing response
   * @param data Response log data
   */
  private logResponse(data: RequestLogData): void {
    const context: any = {
      requestId: data.requestId,
      method: data.method,
      path: data.path,
      statusCode: data.statusCode,
      duration: data.duration,
      responseSize: data.responseSize,
      userId: data.userId,
      sessionId: data.sessionId,
    };

    const emoji = this.getStatusEmoji(data.statusCode || 0);
    const level = this.getLogLevelForStatus(data.statusCode || 0);
    
    const message = `← ${data.method} ${data.path} ${emoji} ${data.statusCode} (${data.duration}ms)`;
    
    switch (level) {
      case 'info':
        Logger.info(message, context);
        break;
      case 'warn':
        Logger.warn(message, context);
        break;
      case 'error':
        Logger.error(message, undefined, context);
        break;
    }

    // Log slow requests
    if (data.duration && data.duration > 1000) {
      console.log(`Slow request: ${data.path}`, data.duration);
    }
  }

  /**
   * Log error response
   * @param data Error log data
   */
  private logErrorResponse(data: RequestLogData): void {
    const context: any = {
      requestId: data.requestId,
      method: data.method,
      path: data.path,
      statusCode: data.statusCode,
      duration: data.duration,
      error: data.error,
      userId: data.userId,
      sessionId: data.sessionId,
    };

    Logger.error(
      `← ${data.method} ${data.path} ❌ ${data.statusCode} (${data.duration}ms)`,
      new Error(data.error?.message || 'Unknown error'),
      context
    );
  }

  /**
   * Calculate response time
   * @param startTime Start timestamp
   * @returns Duration in milliseconds
   */
  // Unused method removed
  /*private calculateResponseTime(startTime: number): number {
    return performance.now() - startTime;
  }*/

  /**
   * Get response size with fallback
   * @param response Response object
   * @returns Response size in bytes
   */
  protected override async getResponseSize(response: Response): Promise<number> {
    try {
      return await super.getResponseSize(response);
    } catch {
      return 0;
    }
  }

  /**
   * Get emoji for status code
   * @param status HTTP status code
   * @returns Status emoji
   */
  private getStatusEmoji(status: number): string {
    if (status >= 200 && status < 300) return '✅';
    if (status >= 300 && status < 400) return '↪️';
    if (status >= 400 && status < 500) return '⚠️';
    if (status >= 500) return '❌';
    return '❓';
  }

  /**
   * Get log level for status code
   * @param status HTTP status code
   * @returns Log level
   */
  private getLogLevelForStatus(status: number): 'info' | 'warn' | 'error' {
    if (status >= 200 && status < 400) return 'info';
    if (status >= 400 && status < 500) return 'warn';
    return 'error';
  }

  /**
   * Sanitize query parameters for logging
   * @param query Query parameters
   * @returns Sanitized query
   */
  private sanitizeQueryParams(query: Record<string, string>): Record<string, string> {
    const sanitized = { ...query };
    const sensitiveParams = ['password', 'token', 'key', 'secret', 'auth'];
    
    Object.keys(sanitized).forEach(key => {
      if (sensitiveParams.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '***MASKED***';
      }
    });
    
    return sanitized;
  }

  /**
   * Get request headers for logging (with sensitive data masked)
   * @param c Hono context
   * @returns Sanitized headers
   */
  // Unused method removed
  /*private getSanitizedHeaders(c: Context): Record<string, string> {
    const headers: Record<string, string> = {};
    
    // Get all headers
    c.req.raw.headers.forEach((value, key) => {
      if (RequestLoggingMiddleware.SENSITIVE_HEADERS.includes(key.toLowerCase())) {
        headers[key] = '***MASKED***';
      } else {
        headers[key] = value;
      }
    });
    
    return headers;
  }*/
}

/**
 * Create request logging middleware instance
 */
export const requestLogging = () => {
  const middleware = new RequestLoggingMiddleware();
  return middleware.create();
};


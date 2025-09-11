/**
 * Standardized Error Handler
 * Consistent error responses across the application
 */

import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { Logger } from './logger';

import type { ApiResponse } from '@/types/api';

/**
 * Error codes enum
 */
export enum ErrorCode {
  // Client errors (4xx)
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Authentication/Authorization
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  MISSING_AUTH_HEADER = 'MISSING_AUTH_HEADER',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  TOKEN_REFRESH_FAILED = 'TOKEN_REFRESH_FAILED',
  SESSION_RESUME_FAILED = 'SESSION_RESUME_FAILED',
  
  // Business logic errors
  QUIZ_NOT_STARTED = 'QUIZ_NOT_STARTED',
  QUIZ_ALREADY_COMPLETED = 'QUIZ_ALREADY_COMPLETED',
  QUESTION_NOT_FOUND = 'QUESTION_NOT_FOUND',
  INVALID_ANSWER = 'INVALID_ANSWER',
  TIME_LIMIT_EXCEEDED = 'TIME_LIMIT_EXCEEDED',
  ACTIVE_SESSION_EXISTS = 'ACTIVE_SESSION_EXISTS',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  
  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  UNIQUE_CONSTRAINT_VIOLATION = 'UNIQUE_CONSTRAINT_VIOLATION',
  FOREIGN_KEY_VIOLATION = 'FOREIGN_KEY_VIOLATION',
  
  // External service errors
  OPENAI_ERROR = 'OPENAI_ERROR',
  CLOUDFLARE_ERROR = 'CLOUDFLARE_ERROR',
  
  // Server errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
}

/**
 * Application error class
 */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Error handler utility
 */
export class ErrorHandler {
  /**
   * Map error codes to HTTP status codes
   */
  private static readonly ERROR_STATUS_MAP: Record<ErrorCode, number> = {
    // 400 Bad Request
    [ErrorCode.BAD_REQUEST]: 400,
    [ErrorCode.VALIDATION_ERROR]: 400,
    
    // 401 Unauthorized
    [ErrorCode.UNAUTHORIZED]: 401,
    [ErrorCode.TOKEN_EXPIRED]: 401,
    [ErrorCode.INVALID_TOKEN]: 401,
    [ErrorCode.MISSING_AUTH_HEADER]: 401,
    [ErrorCode.SESSION_EXPIRED]: 401,
    [ErrorCode.TOKEN_REFRESH_FAILED]: 401,
    [ErrorCode.SESSION_RESUME_FAILED]: 401,
    
    // 403 Forbidden
    [ErrorCode.FORBIDDEN]: 403,
    [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
    
    // 404 Not Found
    [ErrorCode.NOT_FOUND]: 404,
    [ErrorCode.QUESTION_NOT_FOUND]: 404,
    
    // 405 Method Not Allowed
    [ErrorCode.METHOD_NOT_ALLOWED]: 405,
    
    // 409 Conflict
    [ErrorCode.CONFLICT]: 409,
    [ErrorCode.UNIQUE_CONSTRAINT_VIOLATION]: 409,
    [ErrorCode.QUIZ_ALREADY_COMPLETED]: 409,
    
    // 422 Unprocessable Entity
    [ErrorCode.QUIZ_NOT_STARTED]: 422,
    [ErrorCode.INVALID_ANSWER]: 422,
    [ErrorCode.TIME_LIMIT_EXCEEDED]: 422,
    [ErrorCode.FOREIGN_KEY_VIOLATION]: 422,
    [ErrorCode.ACTIVE_SESSION_EXISTS]: 409,
    [ErrorCode.SESSION_NOT_FOUND]: 404,
    
    // 429 Too Many Requests
    [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
    
    // 500 Internal Server Error
    [ErrorCode.INTERNAL_ERROR]: 500,
    [ErrorCode.DATABASE_ERROR]: 500,
    
    // 502 Bad Gateway
    [ErrorCode.OPENAI_ERROR]: 502,
    [ErrorCode.CLOUDFLARE_ERROR]: 502,
    
    // 503 Service Unavailable
    [ErrorCode.SERVICE_UNAVAILABLE]: 503,
    
    // 504 Gateway Timeout
    [ErrorCode.GATEWAY_TIMEOUT]: 504,
  };
  
  /**
   * User-friendly error messages in Turkish
   */
  private static readonly ERROR_MESSAGES: Record<ErrorCode, string> = {
    // Client errors
    [ErrorCode.BAD_REQUEST]: 'Geçersiz istek',
    [ErrorCode.UNAUTHORIZED]: 'Kimlik doğrulama gerekli',
    [ErrorCode.FORBIDDEN]: 'Bu işlem için yetkiniz yok',
    [ErrorCode.NOT_FOUND]: 'Kaynak bulunamadı',
    [ErrorCode.METHOD_NOT_ALLOWED]: 'Bu metod desteklenmiyor',
    [ErrorCode.CONFLICT]: 'Çakışma hatası',
    [ErrorCode.VALIDATION_ERROR]: 'Girdi doğrulama hatası',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Çok fazla istek gönderildi',
    
    // Authentication/Authorization
    [ErrorCode.TOKEN_EXPIRED]: 'Oturum süreniz dolmuş',
    [ErrorCode.INVALID_TOKEN]: 'Geçersiz oturum',
    [ErrorCode.MISSING_AUTH_HEADER]: 'Kimlik doğrulama bilgisi eksik',
    [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'Yetersiz yetki',
    [ErrorCode.SESSION_EXPIRED]: 'Oturum süresi doldu',
    [ErrorCode.TOKEN_REFRESH_FAILED]: 'Token yenileme başarısız',
    [ErrorCode.SESSION_RESUME_FAILED]: 'Oturum devam ettirilemedi',
    
    // Business logic
    [ErrorCode.QUIZ_NOT_STARTED]: 'Yarışma henüz başlamadı',
    [ErrorCode.QUIZ_ALREADY_COMPLETED]: 'Yarışma zaten tamamlandı',
    [ErrorCode.QUESTION_NOT_FOUND]: 'Soru bulunamadı',
    [ErrorCode.INVALID_ANSWER]: 'Geçersiz cevap',
    [ErrorCode.TIME_LIMIT_EXCEEDED]: 'Süre doldu',
    [ErrorCode.ACTIVE_SESSION_EXISTS]: 'Zaten aktif bir oturum var',
    [ErrorCode.SESSION_NOT_FOUND]: 'Oturum bulunamadı',
    
    // Database
    [ErrorCode.DATABASE_ERROR]: 'Veritabanı hatası',
    [ErrorCode.UNIQUE_CONSTRAINT_VIOLATION]: 'Bu kayıt zaten mevcut',
    [ErrorCode.FOREIGN_KEY_VIOLATION]: 'İlişkili kayıt bulunamadı',
    
    // External services
    [ErrorCode.OPENAI_ERROR]: 'AI servisi geçici olarak kullanılamıyor',
    [ErrorCode.CLOUDFLARE_ERROR]: 'Altyapı servisi hatası',
    
    // Server errors
    [ErrorCode.INTERNAL_ERROR]: 'Sunucu hatası oluştu',
    [ErrorCode.SERVICE_UNAVAILABLE]: 'Servis geçici olarak kullanılamıyor',
    [ErrorCode.GATEWAY_TIMEOUT]: 'İstek zaman aşımına uğradı',
  };
  
  /**
   * Handle error and return standardized response
   */
  static handle(error: unknown, c: Context): Response {
    const requestId = c.get('requestId') || 'unknown';
    const timestamp = new Date().toISOString();
    
    // Handle known app errors
    if (error instanceof AppError) {
      this.logError(error, c);
      
      return c.json<ApiResponse>({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
        timestamp,
      }, error.statusCode as any);
    }
    
    // Handle Hono HTTP exceptions
    if (error instanceof HTTPException) {
      const statusCode = error.status;
      const code = this.getErrorCodeFromStatus(statusCode);
      
      this.logError(error, c);
      
      return c.json<ApiResponse>({
        success: false,
        error: {
          code,
          message: error.message,
          requestId,
        },
        timestamp,
      }, statusCode);
    }
    
    // Handle database errors
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return this.createErrorResponse(
        c,
        ErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
        'Bu kayıt zaten mevcut',
        409,
        { field: this.extractFieldFromConstraintError(error.message) }
      );
    }
    
    if (error instanceof Error && error.message.includes('FOREIGN KEY constraint failed')) {
      return this.createErrorResponse(
        c,
        ErrorCode.FOREIGN_KEY_VIOLATION,
        'İlişkili kayıt bulunamadı',
        422
      );
    }
    
    // Handle validation errors from middleware
    if (error instanceof Error && error.name === 'ZodError') {
      return this.createErrorResponse(
        c,
        ErrorCode.VALIDATION_ERROR,
        'Girdi doğrulama hatası',
        400,
        error
      );
    }
    
    // Log unknown errors
    Logger.error('Unhandled error', error as Error, {
      requestId,
      path: c.req.path,
      method: c.req.method,
    });
    
    // Return generic error for unknown cases
    return this.createErrorResponse(
      c,
      ErrorCode.INTERNAL_ERROR,
      'Beklenmeyen bir hata oluştu',
      500
    );
  }
  
  /**
   * Create standardized error response
   */
  static createErrorResponse(
    c: Context,
    code: ErrorCode,
    message?: string,
    statusCode?: number,
    details?: any
  ): Response {
    const requestId = c.get('requestId') || 'unknown';
    const timestamp = new Date().toISOString();
    const finalMessage = message || this.ERROR_MESSAGES[code] || 'Bir hata oluştu';
    const finalStatusCode = statusCode || this.ERROR_STATUS_MAP[code] || 500;
    
    const errorResponse: ApiResponse = {
      success: false,
      error: {
        code,
        message: finalMessage,
        requestId,
        ...(details && { details }),
      },
      timestamp,
    };
    
    return c.json(errorResponse, finalStatusCode as any);
  }
  
  /**
   * Create success response
   */
  static createSuccessResponse<T>(
    c: Context,
    data: T,
    statusCode: number = 200
  ): Response {
    const timestamp = new Date().toISOString();
    
    const successResponse: ApiResponse<T> = {
      success: true,
      data,
      timestamp,
    };
    
    return c.json(successResponse, statusCode as any);
  }
  
  /**
   * Throw standardized app error
   */
  static throwError(
    code: ErrorCode,
    message?: string,
    statusCode?: number,
    details?: any
  ): never {
    const finalMessage = message || this.ERROR_MESSAGES[code] || 'An error occurred';
    const finalStatusCode = statusCode || this.ERROR_STATUS_MAP[code] || 500;
    
    throw new AppError(code, finalMessage, finalStatusCode, details);
  }
  
  /**
   * Log error with context
   */
  private static logError(error: Error, c: Context): void {
    const context = {
      requestId: c.get('requestId'),
      path: c.req.path,
      method: c.req.method,
      ip: c.req.header('CF-Connecting-IP') || 'unknown',
      userAgent: c.req.header('User-Agent'),
      userId: c.get('user')?.id,
    };
    
    if (error instanceof AppError && error.statusCode < 500) {
      // Log client errors as warnings
      Logger.warn(error.message, context);
    } else {
      // Log server errors
      Logger.error(error.message, error, context);
    }
  }
  
  /**
   * Get error code from HTTP status
   */
  private static getErrorCodeFromStatus(status: number): ErrorCode {
    switch (status) {
      case 400: return ErrorCode.BAD_REQUEST;
      case 401: return ErrorCode.UNAUTHORIZED;
      case 403: return ErrorCode.FORBIDDEN;
      case 404: return ErrorCode.NOT_FOUND;
      case 405: return ErrorCode.METHOD_NOT_ALLOWED;
      case 409: return ErrorCode.CONFLICT;
      case 429: return ErrorCode.RATE_LIMIT_EXCEEDED;
      case 500: return ErrorCode.INTERNAL_ERROR;
      case 502: return ErrorCode.CLOUDFLARE_ERROR;
      case 503: return ErrorCode.SERVICE_UNAVAILABLE;
      case 504: return ErrorCode.GATEWAY_TIMEOUT;
      default: return ErrorCode.INTERNAL_ERROR;
    }
  }
  
  /**
   * Extract field name from constraint error
   */
  private static extractFieldFromConstraintError(message: string): string | undefined {
    const match = message.match(/UNIQUE constraint failed: \w+\.(\w+)/);
    return match ? match[1] : undefined;
  }
}

/**
 * Global error handler for Hono
 */
export function globalErrorHandler(err: Error, c: Context): Response {
  return ErrorHandler.handle(err, c);
}

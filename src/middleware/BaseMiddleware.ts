/**
 * Base Middleware Abstract Class
 * Foundation for all middleware implementations
 */

import { Context, Next } from 'hono';
import { Logger } from '@/utils/logger';
import type { Env } from '@/index';

/**
 * Base middleware abstract class
 */
export abstract class BaseMiddleware {
  protected logger = Logger;

  /**
   * Abstract middleware handler method
   * @param c Hono context
   * @param next Next middleware
   */
  abstract handle(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void>;

  /**
   * Get client IP address
   * @param c Hono context
   * @returns Client IP address
   */
  protected getClientIP(c: Context): string {
    // Check various headers for the real IP
    const cfConnectingIP = c.req.header('CF-Connecting-IP');
    if (cfConnectingIP) return cfConnectingIP;

    const xForwardedFor = c.req.header('X-Forwarded-For');
    if (xForwardedFor) {
      // Take the first IP from the comma-separated list
      return xForwardedFor.split(',')[0].trim();
    }

    const xRealIP = c.req.header('X-Real-IP');
    if (xRealIP) return xRealIP;

    // Fallback to direct connection IP
    // In Cloudflare Workers, this might not be available
    return c.req.header('CF-Connecting-IP') || 'unknown';
  }

  /**
   * Get user agent string
   * @param c Hono context
   * @returns User agent
   */
  protected getUserAgent(c: Context): string {
    return c.req.header('User-Agent') || 'Unknown';
  }

  /**
   * Get request ID from context or header
   * @param c Hono context
   * @returns Request ID
   */
  protected getRequestId(c: Context): string {
    // Check if already set in context
    const existingId = c.get('requestId');
    if (existingId) return existingId;

    // Check header
    const headerRequestId = c.req.header('X-Request-ID');
    if (headerRequestId) return headerRequestId;

    // Generate new one
    return Logger.createRequestId();
  }

  /**
   * Set request ID in context and header
   * @param c Hono context
   */
  protected setRequestId(c: Context): void {
    const requestId = this.getRequestId(c);
    
    // Set in context for other middleware
    c.set('requestId', requestId);
    
    // Set in response header
    c.header('X-Request-ID', requestId);
  }

  /**
   * Handle errors uniformly
   * @param error Error object
   * @param c Hono context
   * @returns Error response
   */
  protected handleError(error: Error, c: Context): Response {
    const requestId = this.getRequestId(c);
    const isDevelopment = c.env?.ENVIRONMENT === 'development';

    // Log the error
    this.logger.error('Middleware error', error, {
      requestId,
      path: c.req.path,
      method: c.req.method,
      middleware: this.constructor.name,
    });

    // Create error response
    const errorResponse = {
      success: false,
      error: {
        code: 'MIDDLEWARE_ERROR',
        message: isDevelopment ? error.message : 'An error occurred processing your request',
        requestId,
      },
      timestamp: new Date().toISOString(),
    };

    return c.json(errorResponse, 500);
  }

  /**
   * Log error with context
   * @param error Error object
   * @param context Additional context
   */
  protected logError(error: Error, context: any): void {
    this.logger.error(`Error in ${this.constructor.name}`, error, context);
  }

  /**
   * Get environment value safely
   * @param c Hono context
   * @param key Environment key
   * @param defaultValue Default value
   * @returns Environment value
   */
  protected getEnvValue(c: Context<{ Bindings: Env }>, key: keyof Env, defaultValue?: string): string {
    const value = c.env[key];
    if (value === undefined || value === null) {
      return defaultValue || '';
    }
    return String(value);
  }

  /**
   * Check if request is from a trusted source
   * @param c Hono context
   * @returns True if trusted
   */
  protected isTrustedSource(c: Context): boolean {
    // Cloudflare headers
    const cfRay = c.req.header('CF-Ray');
    const cfIPCountry = c.req.header('CF-IPCountry');
    
    // If we have Cloudflare headers, we're behind CF proxy
    if (cfRay || cfIPCountry) {
      return true;
    }

    // Check for localhost in development
    const host = c.req.header('Host') || '';
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      return c.env?.ENVIRONMENT === 'development';
    }

    return false;
  }

  /**
   * Parse JSON body safely
   * @param c Hono context
   * @returns Parsed body or null
   */
  protected async parseJSONBody(c: Context): Promise<any | null> {
    try {
      const contentType = c.req.header('Content-Type') || '';
      if (!contentType.includes('application/json')) {
        return null;
      }

      return await c.req.json();
    } catch (error) {
      this.logger.warn('Failed to parse JSON body', {
        error: error instanceof Error ? error.message : 'Unknown error',
        path: c.req.path,
      });
      return null;
    }
  }

  /**
   * Get request size
   * @param c Hono context
   * @returns Request size in bytes
   */
  protected getRequestSize(c: Context): number {
    const contentLength = c.req.header('Content-Length');
    if (contentLength) {
      return parseInt(contentLength, 10) || 0;
    }
    return 0;
  }

  /**
   * Get response size from Response object
   * @param response Response object
   * @returns Response size in bytes
   */
  protected async getResponseSize(response: Response): Promise<number> {
    const contentLength = response.headers.get('Content-Length');
    if (contentLength) {
      return parseInt(contentLength, 10) || 0;
    }

    // If no content-length, try to calculate from body
    try {
      const cloned = response.clone();
      const text = await cloned.text();
      return new TextEncoder().encode(text).length;
    } catch {
      return 0;
    }
  }

  /**
   * Create middleware function for Hono
   * @returns Middleware function
   */
  create() {
    return async (c: Context<{ Bindings: Env }>, next: Next) => {
      try {
        return await this.handle(c, next);
      } catch (error) {
        return this.handleError(error as Error, c);
      }
    };
  }
}

/**
 * Middleware priority levels
 */
export enum MiddlewarePriority {
  SECURITY = 0,
  LOGGING = 10,
  CORS = 20,
  RATE_LIMIT = 30,
  AUTH = 40,
  VALIDATION = 50,
  BUSINESS = 100,
}

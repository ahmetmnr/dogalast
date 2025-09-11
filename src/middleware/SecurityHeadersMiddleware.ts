/**
 * Security Headers Middleware
 * Implements OWASP security headers recommendations
 */

import { Context, Next } from 'hono';
import { BaseMiddleware } from './BaseMiddleware';
// Env type import removed - using any for now
import { Environment } from '@/utils/environment';

/**
 * Security headers configuration
 */
interface SecurityHeaders {
  'Strict-Transport-Security': string;
  'X-Content-Type-Options': string;
  'X-Frame-Options': string;
  'X-XSS-Protection': string;
  'Referrer-Policy': string;
  'Content-Security-Policy': string;
  'Permissions-Policy': string;
  'X-Request-ID'?: string;
  'X-DNS-Prefetch-Control': string;
  'X-Download-Options': string;
  'X-Permitted-Cross-Domain-Policies': string;
}

/**
 * CSP directives configuration
 */
interface CSPDirectives {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'font-src': string[];
  'connect-src': string[];
  'media-src': string[];
  'object-src': string[];
  'child-src': string[];
  'frame-src': string[];
  'frame-ancestors': string[];
  'form-action': string[];
  'base-uri': string[];
  'upgrade-insecure-requests'?: boolean;
  'block-all-mixed-content'?: boolean;
}

/**
 * Security headers middleware
 */
export class SecurityHeadersMiddleware extends BaseMiddleware {
  /**
   * Default security headers
   */
  private static readonly DEFAULT_HEADERS: Omit<SecurityHeaders, 'Content-Security-Policy' | 'X-Request-ID'> = {
    // HSTS - Enforce HTTPS for 1 year, including subdomains
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    
    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',
    
    // Prevent clickjacking
    'X-Frame-Options': 'DENY',
    
    // XSS Protection (legacy browsers)
    'X-XSS-Protection': '1; mode=block',
    
    // Referrer Policy
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    
    // Permissions Policy (formerly Feature Policy)
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()',
    
    // DNS Prefetch Control
    'X-DNS-Prefetch-Control': 'off',
    
    // IE8+ force download protection
    'X-Download-Options': 'noopen',
    
    // Adobe cross-domain policies
    'X-Permitted-Cross-Domain-Policies': 'none',
  };

  /**
   * Development CSP directives (more permissive)
   */
  private static readonly DEV_CSP_DIRECTIVES: CSPDirectives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'http://localhost:*', 'ws://localhost:*'],
    'style-src': ["'self'", "'unsafe-inline'", 'http://localhost:*'],
    'img-src': ["'self'", 'data:', 'blob:', 'http://localhost:*', 'https:'],
    'font-src': ["'self'", 'data:', 'http://localhost:*'],
    'connect-src': ["'self'", 'http://localhost:*', 'ws://localhost:*', 'wss://localhost:*', 'https://api.openai.com'],
    'media-src': ["'self'", 'blob:', 'data:'],
    'object-src': ["'none'"],
    'child-src': ["'self'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
  };

  /**
   * Production CSP directives (strict)
   */
  private static readonly PROD_CSP_DIRECTIVES: CSPDirectives = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", 'wss:', 'https://api.openai.com'],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'child-src': ["'self'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'upgrade-insecure-requests': true,
    'block-all-mixed-content': true,
  };

  /**
   * Handle middleware
   * @param c Hono context
   * @param next Next middleware
   */
  async handle(c: Context<{ Bindings: any }>, next: Next): Promise<void> {
    // Set request ID first
    this.setRequestId(c);

    // Process the request
    await next();

    // Apply security headers to response
    this.setSecurityHeaders(c);
  }

  /**
   * Set security headers on response
   * @param c Hono context
   */
  private setSecurityHeaders(c: Context<{ Bindings: any }>): void {
    // Set default headers
    Object.entries(SecurityHeadersMiddleware.DEFAULT_HEADERS).forEach(([key, value]) => {
      c.header(key, value);
    });

    // Set CSP header
    const cspHeader = this.generateCSPHeader(c);
    c.header('Content-Security-Policy', cspHeader);

    // Add request ID to response
    const requestId = c.get('requestId' as never) as string;
    if (requestId) {
      c.header('X-Request-ID', requestId);
    }

    // Additional headers for specific conditions
    this.setConditionalHeaders(c);
  }

  /**
   * Generate Content Security Policy header
   * @param c Hono context
   * @returns CSP header string
   */
  private generateCSPHeader(c: Context<{ Bindings: any }>): string {
    const isDevelopment = Environment.isDevelopment() || 
                         this.getEnvValue(c, 'ENVIRONMENT') === 'development';
    
    const directives = isDevelopment 
      ? SecurityHeadersMiddleware.DEV_CSP_DIRECTIVES 
      : SecurityHeadersMiddleware.PROD_CSP_DIRECTIVES;

    // Build CSP string
    const cspParts: string[] = [];

    Object.entries(directives).forEach(([directive, values]) => {
      if (typeof values === 'boolean') {
        if (values) {
          cspParts.push(directive);
        }
      } else if (Array.isArray(values) && values.length > 0) {
        cspParts.push(`${directive} ${values.join(' ')}`);
      }
    });

    // Add report-uri if configured
    const reportUri = this.getEnvValue(c, 'CSP_REPORT_URI');
    if (reportUri) {
      cspParts.push(`report-uri ${reportUri}`);
      cspParts.push(`report-to csp-endpoint`);
    }

    return cspParts.join('; ');
  }

  /**
   * Set conditional headers based on request/response
   * @param c Hono context
   */
  private setConditionalHeaders(c: Context<{ Bindings: any }>): void {
    // Remove headers that might leak information
    c.header('X-Powered-By', '');
    c.header('Server', '');

    // Set cache headers for security
    const path = c.req.path;
    
    // API endpoints should not be cached
    if (path.startsWith('/api/')) {
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      c.header('Pragma', 'no-cache');
      c.header('Expires', '0');
    }
    
    // Static assets can be cached
    else if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    }
    
    // HTML pages - short cache
    else if (path.match(/\.html$/) || path === '/') {
      c.header('Cache-Control', 'public, max-age=300, must-revalidate');
    }

    // Add security headers for specific content types
    const contentType = c.res.headers.get('Content-Type') || '';
    
    if (contentType.includes('application/json')) {
      // Prevent JSON from being interpreted as HTML
      c.header('X-Content-Type-Options', 'nosniff');
    }
    
    if (contentType.includes('text/html')) {
      // Additional HTML security
      c.header('X-UA-Compatible', 'IE=edge');
    }

    // CORS headers are handled by CORS middleware, but ensure they're not too permissive
    const origin = c.req.header('Origin');
    if (origin && !Environment.isOriginAllowed(origin)) {
      // Remove any CORS headers that might have been set
      c.header('Access-Control-Allow-Origin', '');
      c.header('Access-Control-Allow-Credentials', '');
    }
  }

  /**
   * Create nonce for inline scripts (if needed)
   * @returns Nonce string
   */
  // Unused method removed
  /*private generateNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, Array.from(array)));
  }

  /**
   * Get report-to header value
   * @param c Hono context
   * @returns Report-To header value
   */
  // Unused method removed
  /*private getReportToHeader(c: Context<{ Bindings: any }>): string {
    const reportUri = this.getEnvValue(c, 'CSP_REPORT_URI');
    if (!reportUri) return '';

    return JSON.stringify({
      group: 'csp-endpoint',
      max_age: 10886400, // 126 days
      endpoints: [{
        url: reportUri,
      }],
      include_subdomains: true,
    });
  }*/
}

/**
 * Create security headers middleware instance
 */
export const securityHeaders = () => {
  const middleware = new SecurityHeadersMiddleware();
  return middleware.create();
};

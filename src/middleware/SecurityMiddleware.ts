/**
 * Security Middleware
 * OWASP recommended security headers and protections
 */

import { Context, Next } from 'hono';

import { BaseMiddleware } from './BaseMiddleware';
import { Environment } from '@/utils/environment';
import { Logger } from '@/utils/logger';

/**
 * Security configuration interface
 */
interface SecurityConfig {
  hsts: {
    maxAge: number;
    includeSubDomains: boolean;
    preload: boolean;
  };
  csp: {
    defaultSrc: string[];
    scriptSrc: string[];
    styleSrc: string[];
    imgSrc: string[];
    connectSrc: string[];
    fontSrc: string[];
    mediaSrc: string[];
    frameSrc: string[];
    frameAncestors: string[];
    objectSrc: string[];
    baseUri: string[];
    formAction: string[];
    upgradeInsecureRequests?: boolean;
  };
  permissionsPolicy: {
    camera: string;
    microphone: string;
    geolocation: string;
    payment: string;
    usb: string;
    accelerometer: string;
    gyroscope: string;
    magnetometer: string;
  };
}

/**
 * Security validation result
 */
interface SecurityValidationResult {
  isValid: boolean;
  violations: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * CSP nonce generator for inline scripts
 */
export class CSPNonceGenerator {
  static generateNonce(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
    
    // Fallback for environments without crypto.randomUUID
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }
}

/**
 * Content Security Policy generator
 */
export class CSPGenerator {
  static generateCSP(environment: string, nonce?: string): string {
    const isDevelopment = environment === 'development';
    
    const basePolicy: Record<string, string[]> = {
      'default-src': ["'self'"],
      'script-src': isDevelopment 
        ? ["'self'", "'unsafe-eval'", "'unsafe-inline'", 'localhost:*', 'ws://localhost:*'] 
        : ["'self'", nonce ? `'nonce-${nonce}'` : "'strict-dynamic'"],
      'style-src': isDevelopment
        ? ["'self'", "'unsafe-inline'"]
        : ["'self'", nonce ? `'nonce-${nonce}'` : "'unsafe-inline'"], // CSS için gerekli
      'img-src': ["'self'", 'data:', 'https:', 'blob:'],
      'connect-src': [
        "'self'", 
        'https://api.openai.com',
        'wss://api.openai.com',
        'https://*.cloudflare.com',
        isDevelopment ? 'ws://localhost:*' : '',
        isDevelopment ? 'http://localhost:*' : ''
      ].filter(Boolean),
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'media-src': ["'self'", 'blob:', 'data:'],
      'frame-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'manifest-src': ["'self'"],
      'worker-src': ["'self'", 'blob:'],
    };
    
    // Add upgrade-insecure-requests in production
    if (!isDevelopment) {
      basePolicy['upgrade-insecure-requests'] = [];
    }
    
    return Object.entries(basePolicy)
      .filter(([_, sources]) => sources.length > 0)
      .map(([directive, sources]) => 
        sources.length === 0 
          ? directive 
          : `${directive} ${sources.join(' ')}`
      ).join('; ');
  }
}

/**
 * Request security validator
 */
export class RequestSecurityValidator {
  private static readonly ALLOWED_HOSTS = [
    'localhost',
    '127.0.0.1',
    'zero-waste-quiz.com',
    '*.zero-waste-quiz.com',
    '*.workers.dev'
  ];
  
  private static readonly SUSPICIOUS_USER_AGENTS = [
    /sqlmap/i,
    /nikto/i,
    /scanner/i,
    /nessus/i,
    /nmap/i,
    /havij/i,
    /acunetix/i
  ];
  
  private static readonly MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB
  
  static async validateRequest(c: Context): Promise<SecurityValidationResult> {
    const violations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    
    // Host header validation
    if (!this.validateHostHeader(c)) {
      violations.push('Invalid host header');
      riskLevel = 'high';
    }
    
    // User-Agent validation
    if (!this.validateUserAgent(c)) {
      violations.push('Suspicious user agent');
      riskLevel = 'medium';
    }
    
    // Content-Type validation for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
      if (!this.validateContentType(c)) {
        violations.push('Invalid content type');
        riskLevel = 'medium';
      }
    }
    
    // Request size validation
    if (!await this.validateRequestSize(c)) {
      violations.push('Request too large');
      riskLevel = 'high';
    }
    
    // Path traversal detection
    if (this.detectPathTraversal(c.req.path)) {
      violations.push('Path traversal detected');
      riskLevel = 'high';
    }
    
    return {
      isValid: violations.length === 0,
      violations,
      riskLevel
    };
  }
  
  private static validateHostHeader(c: Context): boolean {
    const host = c.req.header('Host');
    
    if (!host) {
      return false;
    }
    
    // Remove port if present
    const hostname = host.split(':')[0];
    
    return this.ALLOWED_HOSTS.some(allowed => {
      if (allowed.startsWith('*')) {
        const domain = allowed.substring(1);
        return hostname.endsWith(domain);
      }
      return hostname === allowed;
    });
  }
  
  private static validateUserAgent(c: Context): boolean {
    const userAgent = c.req.header('User-Agent');
    
    if (!userAgent) {
      return true; // Allow requests without user-agent
    }
    
    // Check for suspicious patterns
    const isSuspicious = this.SUSPICIOUS_USER_AGENTS.some(pattern => 
      pattern.test(userAgent)
    );
    
    if (isSuspicious) {
      Logger.warn('Suspicious user agent detected', {
        userAgent,
        ip: c.req.header('CF-Connecting-IP') || 'unknown',
        path: c.req.path
      });
    }
    
    return !isSuspicious;
  }
  
  private static validateContentType(c: Context): boolean {
    const contentType = c.req.header('Content-Type');
    
    if (!contentType) {
      return false;
    }
    
    const allowedTypes = [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'text/plain'
    ];
    
    return allowedTypes.some(type => contentType.includes(type));
  }
  
  private static async validateRequestSize(c: Context): Promise<boolean> {
    const contentLength = c.req.header('Content-Length');
    
    if (!contentLength) {
      return true;
    }
    
    const size = parseInt(contentLength, 10);
    
    if (isNaN(size)) {
      return false;
    }
    
    return size <= this.MAX_REQUEST_SIZE;
  }
  
  private static detectPathTraversal(path: string): boolean {
    const traversalPatterns = [
      /\.\./g,
      /\.\.%2[fF]/g,
      /\.\.%5[cC]/g,
      /%2[eE]\./g,
      /%5[cC]\./g
    ];
    
    return traversalPatterns.some(pattern => pattern.test(path));
  }
}

/**
 * Security middleware implementation
 */
export class SecurityMiddleware extends BaseMiddleware {
  private static readonly SECURITY_CONFIG: SecurityConfig = {
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    csp: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.openai.com', 'wss://api.openai.com'],
      fontSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'", 'blob:'],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: true
    },
    permissionsPolicy: {
      camera: '()',
      microphone: '(self)',
      geolocation: '()',
      payment: '()',
      usb: '()',
      accelerometer: '()',
      gyroscope: '()',
      magnetometer: '()'
    }
  };
  
  async handle(c: Context, next: Next): Promise<void> {
    // Generate CSP nonce for this request
    const nonce = CSPNonceGenerator.generateNonce();
    c.set('cspNonce', nonce);
    
    // Set security headers before processing
    this.setSecurityHeaders(c, nonce);
    
    // Validate request security
    const validation = await RequestSecurityValidator.validateRequest(c);
    
    if (!validation.isValid && validation.riskLevel === 'high') {
      // Log security violation
      Logger.error('High-risk security violation', {
        violations: validation.violations,
        ip: this.getClientIP(c),
        userAgent: this.getUserAgent(c),
        path: c.req.path,
        method: c.req.method
      });
      
      // Return 400 for security violations
      c.status(400);
      c.text('Bad Request');
      return;
    }
    
    // Process request
    await next();
    
    // Set additional response headers
    this.setResponseSecurityHeaders(c);
  }
  
  private setSecurityHeaders(c: Context, nonce: string): void {
    const environment = Environment.getEnvironment();
    
    // HSTS - HTTP Strict Transport Security
    if (environment === 'production') {
      const hstsValue = `max-age=${this.SECURITY_CONFIG.hsts.maxAge}`;
      const parts = [hstsValue];
      
      if (this.SECURITY_CONFIG.hsts.includeSubDomains) {
        parts.push('includeSubDomains');
      }
      
      if (this.SECURITY_CONFIG.hsts.preload) {
        parts.push('preload');
      }
      
      c.header('Strict-Transport-Security', parts.join('; '));
    }
    
    // CSP - Content Security Policy
    const cspHeader = CSPGenerator.generateCSP(environment, nonce);
    c.header('Content-Security-Policy', cspHeader);
    
    // Other security headers
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions Policy
    const permissionsPolicy = this.generatePermissionsPolicyHeader();
    c.header('Permissions-Policy', permissionsPolicy);
    
    // Additional headers
    c.header('X-Permitted-Cross-Domain-Policies', 'none');
    c.header('X-Download-Options', 'noopen');
    c.header('X-DNS-Prefetch-Control', 'off');
  }
  
  private setResponseSecurityHeaders(c: Context): void {
    // Remove potentially sensitive headers
    c.header('X-Powered-By', '');
    c.header('Server', '');
    
    // Cache control for sensitive endpoints
    if (c.req.path.includes('/api/admin') || c.req.path.includes('/api/auth')) {
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      c.header('Pragma', 'no-cache');
      c.header('Expires', '0');
    }
  }
  
  private generatePermissionsPolicyHeader(): string {
    const policies = Object.entries(this.SECURITY_CONFIG.permissionsPolicy)
      .map(([feature, value]) => `${feature}=${value}`)
      .join(', ');
    
    return policies;
  }
}

/**
 * Export static handler for easy middleware registration
 */
export const securityMiddleware = SecurityMiddleware.prototype.handle.bind(new SecurityMiddleware());

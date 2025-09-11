/**
 * Rate Limiting Middleware
 * Sliding window rate limiting with multiple strategies
 */

import { Context, Next } from 'hono';

import { BaseMiddleware } from './BaseMiddleware';
import { Logger } from '@/utils/logger';

/**
 * Rate limit rule interface
 */
export interface RateLimitRule {
  endpoint: string;
  method?: string;
  limit: number;
  windowMs: number;
  keyGenerator: (c: Context) => string;
  skipIf?: (c: Context) => boolean;
  message?: string;
  blockDuration?: number; // How long to block after limit exceeded
}

/**
 * Rate limit bucket for sliding window
 */
interface RateLimitBucket {
  count: number;
  resetTime: number;
  buckets: Map<number, number>; // timestamp -> count
  blocked?: boolean;
  blockedUntil?: number;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
  message?: string;
}

/**
 * Adaptive rate limiter for dynamic adjustments
 */
export class AdaptiveRateLimiter {
  private suspiciousIPs = new Map<string, { count: number; until: number }>();
  private trustedIPs = new Set<string>();
  
  adjustLimitForIP(ip: string, baseLimit: number): number {
    // Check if IP is trusted
    if (this.trustedIPs.has(ip)) {
      return Math.floor(baseLimit * 1.5); // 50% higher limit for trusted IPs
    }
    
    // Check if IP is suspicious
    const suspiciousEntry = this.suspiciousIPs.get(ip);
    if (suspiciousEntry && Date.now() < suspiciousEntry.until) {
      // Progressive reduction based on violation count
      const reductionFactor = Math.max(0.1, 1 - (suspiciousEntry.count * 0.2));
      return Math.floor(baseLimit * reductionFactor);
    }
    
    return baseLimit;
  }
  
  markIPAsSuspicious(ip: string, reason: string): void {
    const existing = this.suspiciousIPs.get(ip) || { count: 0, until: 0 };
    
    this.suspiciousIPs.set(ip, {
      count: existing.count + 1,
      until: Date.now() + 60 * 60 * 1000 // 1 hour
    });
    
    Logger.warn('IP marked as suspicious', { 
      ip, 
      reason, 
      violationCount: existing.count + 1 
    });
  }
  
  markIPAsTrusted(ip: string): void {
    this.trustedIPs.add(ip);
    this.suspiciousIPs.delete(ip);
  }
  
  cleanup(): void {
    const now = Date.now();
    
    // Clean expired suspicious entries
    for (const [ip, entry] of this.suspiciousIPs.entries()) {
      if (now > entry.until) {
        this.suspiciousIPs.delete(ip);
      }
    }
  }
}

/**
 * Rate limit engine with sliding window algorithm
 */
export class RateLimitEngine {
  private buckets = new Map<string, RateLimitBucket>();
  private rules: RateLimitRule[] = [];
  private adaptiveLimiter = new AdaptiveRateLimiter();
  private cleanupInterval: number = 5 * 60 * 1000; // 5 minutes
  private lastCleanup: number = Date.now();
  
  addRule(rule: RateLimitRule): void {
    this.rules.push(rule);
  }
  
  async checkLimit(c: Context): Promise<RateLimitResult> {
    // Periodic cleanup
    if (Date.now() - this.lastCleanup > this.cleanupInterval) {
      this.cleanupExpiredBuckets();
      this.adaptiveLimiter.cleanup();
      this.lastCleanup = Date.now();
    }
    
    const applicableRules = this.getApplicableRules(c);
    
    for (const rule of applicableRules) {
      if (rule.skipIf?.(c)) continue;
      
      const key = rule.keyGenerator(c);
      const result = await this.checkRuleLimit(key, rule, c);
      
      if (!result.allowed) {
        return result;
      }
    }
    
    return { 
      allowed: true, 
      remaining: Infinity, 
      resetTime: 0 
    };
  }
  
  private async checkRuleLimit(
    key: string, 
    rule: RateLimitRule,
    context: Context
  ): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    
    if (!bucket) {
      bucket = {
        count: 0,
        resetTime: now + rule.windowMs,
        buckets: new Map()
      };
      this.buckets.set(key, bucket);
    }
    
    // Check if blocked
    if (bucket.blocked && bucket.blockedUntil && now < bucket.blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: bucket.blockedUntil,
        retryAfter: Math.ceil((bucket.blockedUntil - now) / 1000),
        message: rule.message || 'Rate limit exceeded. Please try again later.'
      };
    }
    
    // Clean old entries from sliding window
    const windowStart = now - rule.windowMs;
    for (const [timestamp, _] of bucket.buckets) {
      if (timestamp < windowStart) {
        bucket.buckets.delete(timestamp);
      }
    }
    
    // Calculate current count
    let currentCount = 0;
    for (const [_, count] of bucket.buckets) {
      currentCount += count;
    }
    
    // Adjust limit based on IP reputation
    const ip = context.req.header('CF-Connecting-IP') || 'unknown';
    const adjustedLimit = this.adaptiveLimiter.adjustLimitForIP(ip, rule.limit);
    
    if (currentCount >= adjustedLimit) {
      // Mark as suspicious if repeatedly hitting limits
      if (currentCount > adjustedLimit * 1.5) {
        this.adaptiveLimiter.markIPAsSuspicious(ip, 'Excessive rate limit violations');
      }
      
      // Block for specified duration
      if (rule.blockDuration) {
        bucket.blocked = true;
        bucket.blockedUntil = now + rule.blockDuration;
      }
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: now + rule.windowMs,
        retryAfter: Math.ceil(rule.windowMs / 1000),
        message: rule.message || 'Too many requests'
      };
    }
    
    // Add current request
    const currentSecond = Math.floor(now / 1000) * 1000;
    bucket.buckets.set(currentSecond, (bucket.buckets.get(currentSecond) || 0) + 1);
    
    return {
      allowed: true,
      remaining: adjustedLimit - currentCount - 1,
      resetTime: now + rule.windowMs
    };
  }
  
  private getApplicableRules(c: Context): RateLimitRule[] {
    const path = c.req.path;
    const method = c.req.method;
    
    return this.rules.filter(rule => {
      // Check method match
      if (rule.method && rule.method !== method) {
        return false;
      }
      
      // Check endpoint match
      if (rule.endpoint === '*') {
        return true;
      }
      
      if (rule.endpoint.endsWith('*')) {
        const prefix = rule.endpoint.slice(0, -1);
        return path.startsWith(prefix);
      }
      
      return path === rule.endpoint;
    });
  }
  
  private cleanupExpiredBuckets(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, bucket] of this.buckets) {
      // Remove completely expired buckets
      if (bucket.resetTime < now - 300000) { // 5 minutes grace period
        this.buckets.delete(key);
        cleaned++;
        continue;
      }
      
      // Clean old entries within buckets
      const windowStart = now - 300000; // Keep 5 minutes of history
      for (const [timestamp, _] of bucket.buckets) {
        if (timestamp < windowStart) {
          bucket.buckets.delete(timestamp);
        }
      }
    }
    
    if (cleaned > 0) {
      Logger.debug(`Cleaned ${cleaned} expired rate limit buckets`);
    }
  }
  
  // Get current limit status for a key
  getStatus(key: string): { count: number; limit: number } | null {
    const bucket = this.buckets.get(key);
    if (!bucket) return null;
    
    let count = 0;
    for (const [_, c] of bucket.buckets) {
      count += c;
    }
    
    return { count, limit: 0 }; // Limit needs rule context
  }
}

/**
 * Rate limiting middleware
 */
export class RateLimitMiddleware extends BaseMiddleware {
  private static instance: RateLimitMiddleware;
  private engine: RateLimitEngine;
  
  constructor() {
    super();
    this.engine = new RateLimitEngine();
    this.setupRules();
  }
  
  static getInstance(): RateLimitMiddleware {
    if (!this.instance) {
      this.instance = new RateLimitMiddleware();
    }
    return this.instance;
  }
  
  async handle(c: Context, next: Next): Promise<Response | void> {
    const result = await this.engine.checkLimit(c);
    
    // Always set rate limit headers
    c.header('X-RateLimit-Limit', result.remaining === Infinity ? '1000' : 
      (result.remaining + 1).toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', result.resetTime.toString());
    
    if (!result.allowed) {
      c.header('Retry-After', result.retryAfter?.toString() || '60');
      
      // Log rate limit violation
      Logger.warn('Rate limit exceeded', {
        ip: this.getClientIP(c),
        path: c.req.path,
        method: c.req.method,
        userAgent: this.getUserAgent(c),
        message: result.message
      });
      
      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: result.message || 'Too many requests. Please try again later.',
          retryAfter: result.retryAfter
        },
        timestamp: new Date().toISOString()
      }, 429);
    }
    
    await next();
  }
  
  private setupRules(): void {
    // Global rate limit - per IP
    this.engine.addRule({
      endpoint: '*',
      limit: 1000,
      windowMs: 60 * 60 * 1000, // 1 hour
      keyGenerator: (c) => `global:${this.getClientIP(c)}`,
      message: 'Global rate limit exceeded. Please try again later.',
      skipIf: (c) => c.req.path === '/health' // Skip health checks
    });
    
    // Registration endpoint - strict limit
    this.engine.addRule({
      endpoint: '/api/register',
      method: 'POST',
      limit: 5,
      windowMs: 60 * 1000, // 1 minute
      keyGenerator: (c) => `register:${this.getClientIP(c)}`,
      message: 'Registration rate limit exceeded. Please wait before trying again.',
      blockDuration: 5 * 60 * 1000 // Block for 5 minutes after limit
    });
    
    // Tool dispatch - per user
    this.engine.addRule({
      endpoint: '/api/tools/dispatch',
      method: 'POST',
      limit: 60,
      windowMs: 60 * 1000, // 1 minute
      keyGenerator: (c) => {
        const user = c.get('user');
        return user ? `tools:user:${user.id}` : `tools:ip:${this.getClientIP(c)}`;
      },
      message: 'Tool dispatch rate limit exceeded. Please slow down.',
    });
    
    // Admin endpoints - per admin user
    this.engine.addRule({
      endpoint: '/api/admin/*',
      limit: 30,
      windowMs: 60 * 1000, // 1 minute
      keyGenerator: (c) => {
        const user = c.get('user');
        return user ? `admin:${user.id}` : `admin:${this.getClientIP(c)}`;
      },
      message: 'Admin rate limit exceeded.',
    });
    
    // Login attempts - very strict
    this.engine.addRule({
      endpoint: '/api/auth/login',
      method: 'POST',
      limit: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
      keyGenerator: (c) => `login:${this.getClientIP(c)}`,
      message: 'Too many login attempts. Please try again later.',
      blockDuration: 30 * 60 * 1000 // Block for 30 minutes
    });
    
    // Admin login - even stricter
    this.engine.addRule({
      endpoint: '/api/admin/login',
      method: 'POST',
      limit: 3,
      windowMs: 15 * 60 * 1000, // 15 minutes
      keyGenerator: (c) => `admin-login:${this.getClientIP(c)}`,
      message: 'Too many admin login attempts. Account may be locked.',
      blockDuration: 60 * 60 * 1000 // Block for 1 hour
    });
    
    // Leaderboard - prevent spam
    this.engine.addRule({
      endpoint: '/api/leaderboard',
      method: 'GET',
      limit: 30,
      windowMs: 60 * 1000, // 1 minute
      keyGenerator: (c) => `leaderboard:${this.getClientIP(c)}`,
      message: 'Leaderboard rate limit exceeded.',
    });
    
    // Password reset - prevent abuse
    this.engine.addRule({
      endpoint: '/api/auth/reset-password',
      method: 'POST',
      limit: 3,
      windowMs: 60 * 60 * 1000, // 1 hour
      keyGenerator: (c) => `reset:${this.getClientIP(c)}`,
      message: 'Too many password reset attempts.',
      blockDuration: 60 * 60 * 1000 // Block for 1 hour
    });
  }
}

/**
 * Export singleton instance handler
 */
export const rateLimitMiddleware = RateLimitMiddleware.getInstance().handle.bind(RateLimitMiddleware.getInstance());

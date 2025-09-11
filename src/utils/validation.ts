/**
 * Input Validation Utilities
 * Security-focused validation and sanitization
 */

import { z } from 'zod';

/**
 * Validation result interface
 */
export interface ValidationResult {
  /** Whether the input is valid */
  isValid: boolean;
  
  /** Validation errors */
  errors: string[];
  
  /** Sanitized value (if applicable) */
  sanitized?: string;
}

/**
 * Email validation regex
 */
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Phone validation regex (Turkey format)
 */
const PHONE_REGEX = /^(\+90|0)?[1-9][0-9]{9}$/;

/**
 * SQL injection patterns to detect
 */
const SQL_INJECTION_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/i,
  /(--|\||;|\/\*|\*\/|xp_|sp_)/i,
  /(\b(and|or)\b\s*\d+\s*=\s*\d+)/i,
];

/**
 * XSS patterns to detect
 */
const XSS_PATTERNS = [
  /<script[^>]*>.*?<\/script>/gi,
  /<iframe[^>]*>.*?<\/iframe>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
];

/**
 * Validation utilities class
 */
export class ValidationUtils {
  /**
   * Sanitize general input
   * @param input User input
   * @returns Sanitized input
   */
  static sanitizeInput(input: string): string {
    if (!input) return '';
    
    // Trim whitespace
    let sanitized = input.trim();
    
    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');
    
    // Normalize unicode
    sanitized = sanitized.normalize('NFC');
    
    // Remove control characters (except newlines and tabs)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    return sanitized;
  }

  /**
   * Sanitize email address
   * @param email Email input
   * @returns Sanitized email
   */
  static sanitizeEmail(email: string): string {
    if (!email) return '';
    
    // Basic sanitization
    let sanitized = this.sanitizeInput(email);
    
    // Convert to lowercase
    sanitized = sanitized.toLowerCase();
    
    // Remove any remaining spaces
    sanitized = sanitized.replace(/\s/g, '');
    
    // Validate email format
    if (!EMAIL_REGEX.test(sanitized)) {
      return '';
    }
    
    return sanitized;
  }

  /**
   * Sanitize phone number
   * @param phone Phone input
   * @returns Sanitized phone number
   */
  static sanitizePhoneNumber(phone: string): string {
    if (!phone) return '';
    
    // Remove all non-numeric characters except +
    let sanitized = phone.replace(/[^\d+]/g, '');
    
    // Validate phone format
    if (!PHONE_REGEX.test(sanitized)) {
      return '';
    }
    
    // Normalize to standard format (without country code)
    if (sanitized.startsWith('+90')) {
      sanitized = sanitized.substring(3);
    } else if (sanitized.startsWith('0')) {
      sanitized = sanitized.substring(1);
    }
    
    return sanitized;
  }

  /**
   * Escape HTML to prevent XSS
   * @param input HTML input
   * @returns Escaped HTML
   */
  static escapeHtml(input: string): string {
    if (!input) return '';
    
    const htmlEscapes: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;',
    };
    
    return input.replace(/[&<>"'/]/g, (char) => htmlEscapes[char] || char);
  }

  /**
   * Strip HTML tags
   * @param input HTML input
   * @returns Text without HTML tags
   */
  static stripHtml(input: string): string {
    if (!input) return '';
    
    // Remove all HTML tags
    let stripped = input.replace(/<[^>]*>/g, '');
    
    // Decode HTML entities
    stripped = stripped
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');
    
    return stripped;
  }

  /**
   * Validate SQL input for injection attempts
   * @param input User input
   * @returns True if input is safe
   */
  static validateSqlInput(input: string): boolean {
    if (!input) return true;
    
    // Check against SQL injection patterns
    for (const pattern of SQL_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Validate question text
   * @param text Question text
   * @returns Validation result
   */
  static validateQuestionText(text: string): ValidationResult {
    const errors: string[] = [];
    
    if (!text) {
      errors.push('Question text is required');
      return { isValid: false, errors };
    }
    
    const sanitized = this.sanitizeInput(text);
    
    // Length validation
    if (sanitized.length < 10) {
      errors.push('Question text must be at least 10 characters');
    }
    
    if (sanitized.length > 500) {
      errors.push('Question text must not exceed 500 characters');
    }
    
    // Check for XSS attempts
    for (const pattern of XSS_PATTERNS) {
      if (pattern.test(sanitized)) {
        errors.push('Question text contains invalid content');
        break;
      }
    }
    
    // Check for SQL injection
    if (!this.validateSqlInput(sanitized)) {
      errors.push('Question text contains suspicious patterns');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      sanitized: errors.length === 0 ? sanitized : undefined,
    };
  }

  /**
   * Validate answer text
   * @param answer Answer text
   * @returns Validation result
   */
  static validateAnswerText(answer: string): ValidationResult {
    const errors: string[] = [];
    
    if (!answer) {
      errors.push('Answer is required');
      return { isValid: false, errors };
    }
    
    const sanitized = this.sanitizeInput(answer);
    
    // Length validation
    if (sanitized.length < 1) {
      errors.push('Answer must not be empty');
    }
    
    if (sanitized.length > 200) {
      errors.push('Answer must not exceed 200 characters');
    }
    
    // Check for suspicious content
    if (!this.validateSqlInput(sanitized)) {
      errors.push('Answer contains suspicious patterns');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      sanitized: errors.length === 0 ? sanitized : undefined,
    };
  }

  /**
   * Validate session ID format
   * @param sessionId Session ID
   * @returns True if valid UUID format
   */
  static validateSessionId(sessionId: string): boolean {
    if (!sessionId) return false;
    
    // UUID v4 format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(sessionId);
  }

  /**
   * Check if IP address is valid
   * @param ip IP address
   * @returns True if valid IPv4 or IPv6
   */
  static isValidIPAddress(ip: string): boolean {
    if (!ip) return false;
    
    // IPv4 regex
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    
    // IPv6 regex (simplified)
    const ipv6Regex = /^([\da-f]{1,4}:){7}[\da-f]{1,4}$/i;
    
    if (ipv4Regex.test(ip)) {
      // Validate IPv4 octets
      const octets = ip.split('.');
      return octets.every(octet => {
        const num = parseInt(octet, 10);
        return num >= 0 && num <= 255;
      });
    }
    
    return ipv6Regex.test(ip);
  }

  /**
   * Normalize user agent string
   * @param userAgent User agent string
   * @returns Normalized user agent
   */
  static normalizeUserAgent(userAgent: string): string {
    if (!userAgent) return 'Unknown';
    
    // Truncate to reasonable length
    let normalized = userAgent.substring(0, 500);
    
    // Remove any control characters
    normalized = normalized.replace(/[\x00-\x1F\x7F]/g, '');
    
    return normalized;
  }

  /**
   * Validate username
   * @param username Username input
   * @returns Validation result
   */
  static validateUsername(username: string): ValidationResult {
    const errors: string[] = [];
    
    if (!username) {
      errors.push('Username is required');
      return { isValid: false, errors };
    }
    
    const sanitized = this.sanitizeInput(username);
    
    // Length validation
    if (sanitized.length < 3) {
      errors.push('Username must be at least 3 characters');
    }
    
    if (sanitized.length > 30) {
      errors.push('Username must not exceed 30 characters');
    }
    
    // Character validation
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
      errors.push('Username can only contain letters, numbers, underscores, and hyphens');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      sanitized: errors.length === 0 ? sanitized : undefined,
    };
  }

  /**
   * Validate password strength
   * @param password Password input
   * @returns Validation result
   */
  static validatePassword(password: string): ValidationResult {
    const errors: string[] = [];
    
    if (!password) {
      errors.push('Password is required');
      return { isValid: false, errors };
    }
    
    // Length validation
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters');
    }
    
    if (password.length > 128) {
      errors.push('Password must not exceed 128 characters');
    }
    
    // Complexity requirements
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create Zod schema for participant registration
   */
  static createParticipantSchema() {
    return z.object({
      name: z.string()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name must not exceed 100 characters')
        .transform(val => this.sanitizeInput(val)),
      
      email: z.string()
        .email('Invalid email address')
        .optional()
        .transform(val => val ? this.sanitizeEmail(val) : undefined),
      
      phone: z.string()
        .regex(PHONE_REGEX, 'Invalid phone number')
        .optional()
        .transform(val => val ? this.sanitizePhoneNumber(val) : undefined),
      
      consentTerms: z.boolean()
        .refine(val => val === true, 'You must accept the terms'),
      
      consentMarketing: z.boolean(),
    });
  }

  /**
   * Create Zod schema for question creation
   */
  static createQuestionSchema() {
    return z.object({
      text: z.string()
        .min(10, 'Question must be at least 10 characters')
        .max(500, 'Question must not exceed 500 characters')
        .transform(val => this.sanitizeInput(val)),
      
      correctAnswer: z.string()
        .min(1, 'Answer is required')
        .max(200, 'Answer must not exceed 200 characters')
        .transform(val => this.sanitizeInput(val)),
      
      options: z.array(z.string()).optional(),
      
      difficulty: z.number()
        .int()
        .min(1)
        .max(5),
      
      basePoints: z.number()
        .int()
        .min(10)
        .max(1000),
      
      timeLimit: z.number()
        .int()
        .min(10)
        .max(300),
      
      category: z.string()
        .min(1)
        .max(50),
      
      orderNo: z.number()
        .int()
        .min(1),
    });
  }
}

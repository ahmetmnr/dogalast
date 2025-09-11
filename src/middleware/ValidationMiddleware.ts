/**
 * Validation Middleware
 * Input validation and sanitization using Zod
 */

import { z } from 'zod';
import { Context, Next } from 'hono';

import { BaseMiddleware } from './BaseMiddleware';
import { Logger } from '@/utils/logger';

/**
 * Registration validation schema
 */
export const registrationSchema = z.object({
  name: z.string()
    .min(2, 'İsim en az 2 karakter olmalıdır')
    .max(50, 'İsim en fazla 50 karakter olabilir')
    .regex(/^[a-zA-ZğüşıöçĞÜŞİÖÇ\s]+$/, 'İsim sadece harf içerebilir')
    .transform(val => val.trim()),
  
  email: z.string()
    .email('Geçerli bir e-posta adresi giriniz')
    .transform(val => val.toLowerCase().trim())
    .optional()
    .or(z.literal('')),
  
  phone: z.string()
    .regex(/^(\+90|0)?[5][0-9]{9}$/, 'Geçerli bir telefon numarası giriniz')
    .transform(val => val.replace(/\D/g, ''))
    .optional()
    .or(z.literal('')),
  
  consentMarketing: z.boolean(),
  
  consentTerms: z.boolean()
    .refine(val => val === true, 'Kullanım şartlarını kabul etmelisiniz')
}).refine(
  data => data.email || data.phone,
  'E-posta veya telefon numarasından en az biri gereklidir'
);

/**
 * Tool dispatch validation schema
 */
export const toolDispatchSchema = z.object({
  tool: z.enum([
    'startQuiz', 
    'nextQuestion', 
    'markTTSEnd', 
    'markSpeechStart',
    'submitAnswer', 
    'finishQuiz', 
    'infoLookup'
  ], { 
    errorMap: () => ({ message: 'Geçersiz tool adı' }) 
  }),
  
  args: z.record(z.any()).default({}),
  
  sessionId: z.string()
    .uuid('Geçersiz session ID')
    .optional(),
  
  jwt: z.string()
    .min(1, 'JWT token gerekli')
    .optional()
});

/**
 * Admin login validation schema
 */
export const adminLoginSchema = z.object({
  username: z.string()
    .min(3, 'Kullanıcı adı en az 3 karakter olmalıdır')
    .max(20, 'Kullanıcı adı en fazla 20 karakter olabilir')
    .regex(/^[a-zA-Z0-9_]+$/, 'Kullanıcı adı sadece harf, rakam ve _ içerebilir')
    .transform(val => val.toLowerCase().trim()),
  
  password: z.string()
    .min(8, 'Şifre en az 8 karakter olmalıdır')
    .max(128, 'Şifre çok uzun')
});

/**
 * Question management validation schema
 */
export const questionSchema = z.object({
  text: z.string()
    .min(10, 'Soru metni en az 10 karakter olmalıdır')
    .max(500, 'Soru metni en fazla 500 karakter olabilir')
    .transform(val => val.trim()),
  
  correctAnswer: z.string()
    .min(1, 'Doğru cevap boş olamaz')
    .max(200, 'Doğru cevap en fazla 200 karakter olabilir')
    .transform(val => val.trim()),
  
  options: z.array(z.string().transform(val => val.trim()))
    .min(2, 'En az 2 seçenek olmalıdır')
    .max(6, 'En fazla 6 seçenek olabilir')
    .optional(),
  
  difficulty: z.number()
    .int('Zorluk seviyesi tam sayı olmalıdır')
    .min(1, 'Zorluk seviyesi en az 1 olmalıdır')
    .max(5, 'Zorluk seviyesi en fazla 5 olabilir'),
  
  basePoints: z.number()
    .int('Puan tam sayı olmalıdır')
    .min(1, 'Puan en az 1 olmalıdır')
    .max(100, 'Puan en fazla 100 olabilir'),
  
  timeLimit: z.number()
    .int('Süre tam sayı olmalıdır')
    .min(5, 'Süre en az 5 saniye olmalıdır')
    .max(120, 'Süre en fazla 120 saniye olabilir'),
  
  category: z.string()
    .min(1, 'Kategori boş olamaz')
    .max(50, 'Kategori en fazla 50 karakter olabilir')
    .transform(val => val.trim())
    .default('zero_waste')
});

/**
 * Answer submission validation schema
 */
export const answerSubmissionSchema = z.object({
  sessionId: z.string().uuid('Geçersiz session ID'),
  questionId: z.string().uuid('Geçersiz soru ID'),
  answer: z.string()
    .min(1, 'Cevap boş olamaz')
    .max(500, 'Cevap çok uzun')
    .transform(val => val.trim()),
  responseTime: z.number()
    .int('Yanıt süresi tam sayı olmalıdır')
    .min(0, 'Yanıt süresi negatif olamaz')
    .max(300000, 'Yanıt süresi çok uzun'), // Max 5 minutes
  clientTimestamp: z.number()
    .int('Zaman damgası geçersiz')
    .optional()
});

/**
 * Leaderboard query validation schema
 */
export const leaderboardQuerySchema = z.object({
  limit: z.string()
    .regex(/^\d+$/, 'Limit sayı olmalıdır')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().min(1).max(100))
    .optional()
    .default('10'),
  
  offset: z.string()
    .regex(/^\d+$/, 'Offset sayı olmalıdır')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().min(0))
    .optional()
    .default('0'),
  
  period: z.enum(['all', 'today', 'week', 'month'])
    .optional()
    .default('all')
});

/**
 * User data export request schema
 */
export const dataExportSchema = z.object({
  participantId: z.number()
    .int('Katılımcı ID tam sayı olmalıdır')
    .positive('Katılımcı ID pozitif olmalıdır'),
  
  format: z.enum(['json', 'csv', 'pdf'])
    .optional()
    .default('json'),
  
  includeAudio: z.boolean()
    .optional()
    .default(false),
  
  dateRange: z.object({
    start: z.string().datetime('Geçersiz başlangıç tarihi'),
    end: z.string().datetime('Geçersiz bitiş tarihi')
  }).optional()
});

/**
 * Advanced input sanitizer
 */
export class InputSanitizer {
  /**
   * XSS prevention - removes dangerous HTML
   */
  static sanitizeHTML(input: string): string {
    // Remove script tags
    input = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove javascript: URLs
    input = input.replace(/javascript:/gi, '');
    
    // Remove on* event handlers
    input = input.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    
    // Remove dangerous protocols
    input = input.replace(/(?:data|vbscript):/gi, '');
    
    // HTML entity encoding for remaining content
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;'
    };
    
    return input.replace(/[&<>"'\/]/g, char => htmlEntities[char] || char);
  }
  
  /**
   * SQL injection prevention (additional to parameterized queries)
   */
  static sanitizeSQL(input: string): string {
    // Log potential SQL injection attempts
    const sqlKeywords = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi;
    
    if (sqlKeywords.test(input)) {
      Logger.warn('Potential SQL injection attempt detected', { 
        input: input.substring(0, 100) // Log only first 100 chars
      });
    }
    
    // Remove SQL comments
    input = input.replace(/--.*$/gm, '');
    input = input.replace(/\/\*[\s\S]*?\*\//g, '');
    
    return input;
  }
  
  /**
   * Path traversal prevention
   */
  static sanitizePath(path: string): string {
    // Remove path traversal attempts
    path = path.replace(/\.\./g, '');
    path = path.replace(/\.\.%2[fF]/g, '');
    path = path.replace(/\.\.%5[cC]/g, '');
    path = path.replace(/%2[eE]\./g, '');
    path = path.replace(/%5[cC]\./g, '');
    
    // Remove dangerous characters
    path = path.replace(/[<>:"|?*]/g, '');
    
    // Ensure path doesn't start with /
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    
    return path;
  }
  
  /**
   * Phone number normalization for Turkey
   */
  static normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters
    phone = phone.replace(/\D/g, '');
    
    // Convert to Turkish format
    if (phone.startsWith('90')) {
      phone = '+' + phone;
    } else if (phone.startsWith('0')) {
      phone = '+90' + phone.substring(1);
    } else if (phone.length === 10 && phone.startsWith('5')) {
      phone = '+90' + phone;
    }
    
    return phone;
  }
  
  /**
   * Email normalization and validation
   */
  static normalizeEmail(email: string): string {
    // Convert to lowercase and trim
    email = email.toLowerCase().trim();
    
    // Remove dots from gmail addresses (before @)
    if (email.includes('@gmail.com')) {
      const [localPart, domain] = email.split('@');
      if (localPart) {
        email = localPart.replace(/\./g, '') + '@' + domain;
      }
    }
    
    // Remove + aliases
    const atIndex = email.indexOf('@');
    const plusIndex = email.indexOf('+');
    if (plusIndex > 0 && plusIndex < atIndex) {
      email = email.substring(0, plusIndex) + email.substring(atIndex);
    }
    
    return email;
  }
  
  /**
   * Unicode normalization to prevent homograph attacks
   */
  static normalizeUnicode(text: string): string {
    // Normalize to NFC (Canonical Decomposition, followed by Canonical Composition)
    return text.normalize('NFC');
  }
}

/**
 * Validation middleware implementation
 */
export class ValidationMiddleware extends BaseMiddleware {
  /**
   * Validate request body with Zod schema
   */
  static validateBody<T>(schema: z.ZodSchema<T>) {
    return async (c: Context, next: Next): Promise<Response | void> => {
      try {
        // Parse JSON body
        let body: any;
        try {
          body = await c.req.json();
        } catch (error) {
          return c.json({
            success: false,
            error: {
              code: 'INVALID_JSON',
              message: 'Geçersiz JSON formatı'
            },
            timestamp: new Date().toISOString()
          }, 400);
        }
        
        // Sanitize input before validation
        const sanitizedBody = this.sanitizeInput(body);
        
        // Validate with schema
        const validatedData = schema.parse(sanitizedBody);
        
        // Store validated data in context
        c.set('validatedBody', validatedData);
        
        await next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Girdi doğrulama hatası',
              details: this.formatZodErrors(error)
            },
            timestamp: new Date().toISOString()
          }, 400);
        }
        
        Logger.error('Validation middleware error', error as Error);
        return c.json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Doğrulama sırasında hata oluştu'
          },
          timestamp: new Date().toISOString()
        }, 500);
      }
    };
  }
  
  /**
   * Validate query parameters with Zod schema
   */
  static validateQuery<T>(schema: z.ZodSchema<T>) {
    return async (c: Context, next: Next): Promise<Response | void> => {
      try {
        const query = c.req.query();
        const sanitizedQuery = this.sanitizeInput(query);
        const validatedQuery = schema.parse(sanitizedQuery);
        
        c.set('validatedQuery', validatedQuery);
        await next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Query parametresi doğrulama hatası',
              details: this.formatZodErrors(error)
            },
            timestamp: new Date().toISOString()
          }, 400);
        }
        
        throw error;
      }
    };
  }
  
  /**
   * Validate URL parameters with Zod schema
   */
  static validateParams<T>(schema: z.ZodSchema<T>) {
    return async (c: Context, next: Next): Promise<Response | void> => {
      try {
        const params = c.req.param();
        const sanitizedParams = this.sanitizeInput(params);
        const validatedParams = schema.parse(sanitizedParams);
        
        c.set('validatedParams', validatedParams);
        await next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          return c.json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'URL parametresi doğrulama hatası',
              details: this.formatZodErrors(error)
            },
            timestamp: new Date().toISOString()
          }, 400);
        }
        
        throw error;
      }
    };
  }
  
  /**
   * Sanitize input recursively
   */
  private static sanitizeInput(input: any): any {
    if (input === null || input === undefined) {
      return input;
    }
    
    if (typeof input === 'string') {
      return this.sanitizeString(input);
    }
    
    if (Array.isArray(input)) {
      return input.map(item => this.sanitizeInput(item));
    }
    
    if (typeof input === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        // Sanitize key as well
        const sanitizedKey = this.sanitizeString(key);
        sanitized[sanitizedKey] = this.sanitizeInput(value);
      }
      return sanitized;
    }
    
    return input;
  }
  
  /**
   * Sanitize individual string
   */
  private static sanitizeString(str: string): string {
    if (typeof str !== 'string') {
      return str;
    }
    
    // HTML escape
    str = InputSanitizer.sanitizeHTML(str);
    
    // Unicode normalization
    str = InputSanitizer.normalizeUnicode(str);
    
    // Trim whitespace
    str = str.trim();
    
    // Remove null bytes
    str = str.replace(/\0/g, '');
    
    return str;
  }
  
  /**
   * Format Zod errors for user-friendly display
   */
  private static formatZodErrors(error: z.ZodError): any[] {
    return error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
      code: err.code,
      ...(err.code === 'invalid_type' && {
        expected: err.expected,
        received: err.received
      })
    }));
  }
  
  async handle(_c: Context, next: Next): Promise<void> {
    // This can be used for global validation if needed
    await next();
  }
}

/**
 * Export validation schemas for easy access
 */
export const schemas = {
  registration: registrationSchema,
  toolDispatch: toolDispatchSchema,
  adminLogin: adminLoginSchema,
  question: questionSchema,
  answerSubmission: answerSubmissionSchema,
  leaderboardQuery: leaderboardQuerySchema,
  dataExport: dataExportSchema,
  refreshToken: z.object({
    sessionId: z.string().uuid('Geçersiz session ID'),
    currentToken: z.string().optional()
  })
};

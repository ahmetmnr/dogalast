import { z } from 'zod'
import { Next } from 'hono'
import { ErrorCode, AppError } from '@/types/errors'
import type { AppContext } from '@/types/api'
import { createLogger } from '@/config/environment'

const logger = createLogger('validation-middleware')

// Validation schemas
export const schemas = {
  // Registration schema
  registration: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    consentTerms: z.boolean().refine(val => val === true, {
      message: 'Terms consent is required'
    }),
    consentPrivacy: z.boolean().default(true),
    consentMarketing: z.boolean().default(false)
  }),

  // Tool dispatch schema
  toolDispatch: z.object({
    tool: z.string().min(1),
    args: z.record(z.any()).optional().default({}),
    sessionId: z.string().uuid().nullable().optional(),
    idempotencyKey: z.string().optional()
  }),

  // Session resume schema
  sessionResume: z.object({
    sessionId: z.string().uuid(),
    lastEventId: z.string().optional()
  }),

  // Answer submission schema
  answerSubmission: z.object({
    sessionQuestionId: z.string().uuid(),
    answer: z.string().min(1),
    responseTime: z.number().min(0),
    confidence: z.number().min(0).max(1).optional()
  }),

  // Admin login schema - EKLENDI
  adminLogin: z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  }),

  // Question management schema
  questionManagement: z.object({
    title: z.string().min(1),
    content: z.string().min(1),
    correctAnswer: z.string().min(1),
    category: z.string().min(1),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    timeLimit: z.number().min(10).max(300).default(30),
    points: z.number().min(1).max(1000).default(100)
  }),

  // User management schema
  userManagement: z.object({
    action: z.enum(['activate', 'deactivate', 'delete']),
    reason: z.string().optional()
  })
}

// Query schemas - EXPORT EKLENDI
export const querySchemas = {
  // Leaderboard query
  leaderboard: z.object({
    limit: z.string()
      .optional()
      .default('50')
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1).max(100)),
    offset: z.string()
      .optional()
      .default('0')
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(0)),
    period: z.enum(['all', 'today', 'week', 'month']).default('all')
  }),

  // Pagination query
  pagination: z.object({
    page: z.string()
      .optional()
      .default('1')
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1)),
    pageSize: z.string()
      .optional()
      .default('20')
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1).max(100)),
    search: z.string().optional()
  }),

  // Audit logs query
  auditLogs: z.object({
    page: z.string()
      .optional()
      .default('1')
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1)),
    pageSize: z.string()
      .optional()
      .default('20')
      .transform(val => parseInt(val, 10))
      .pipe(z.number().min(1).max(100)),
    tableName: z.string().optional(),
    action: z.enum(['INSERT', 'UPDATE', 'DELETE', 'SELECT']).optional()
  })
}

export class ValidationMiddleware {
  static validateBody<T extends z.ZodType>(schema: T) {
    return async (c: AppContext, next: Next) => {
      try {
        const body = await c.req.json()
        const validatedBody = schema.parse(body)
        c.set('validatedBody', validatedBody)
        await next()
      } catch (error) {
        logger.error('Body validation failed:', error)
        
        if (error instanceof z.ZodError) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Request body validation failed',
            400,
            {
              errors: error.errors.map(err => ({
                path: err.path.join('.'),
                message: err.message,
                code: err.code
              }))
            }
          )
        }
        throw error
      }
    }
  }

  static validateQuery<T extends z.ZodType>(schema: T) {
    return async (c: AppContext, next: Next) => {
      try {
        const query = c.req.query()
        const validatedQuery = schema.parse(query)
        c.set('validatedQuery', validatedQuery)
        await next()
      } catch (error) {
        logger.error('Query validation failed:', error)
        
        if (error instanceof z.ZodError) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Query parameters validation failed',
            400,
            {
              errors: error.errors.map(err => ({
                path: err.path.join('.'),
                message: err.message,
                code: err.code
              }))
            }
          )
        }
        throw error
      }
    }
  }

  static validateParams<T extends z.ZodType>(schema: T) {
    return async (c: AppContext, next: Next) => {
      try {
        const params = c.req.param()
        const validatedParams = schema.parse(params)
        c.set('validatedParams', validatedParams)
        await next()
      } catch (error) {
        logger.error('Params validation failed:', error)
        
        if (error instanceof z.ZodError) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Path parameters validation failed',
            400,
            {
              errors: error.errors.map(err => ({
                path: err.path.join('.'),
                message: err.message,
                code: err.code
              }))
            }
          )
        }
        throw error
      }
    }
  }
}
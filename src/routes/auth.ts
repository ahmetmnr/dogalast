import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'

// Database schema
import { participants, quizSessions, adminUsers } from '@/db/schema'

// Services
import { JWTService } from '@/services/JWTService'
import { PrivacyService } from '@/services/PrivacyService'
import { ConnectionRecoveryService } from '@/services/ConnectionRecoveryService'

// Middleware
import { ValidationMiddleware, schemas } from '@/middleware/validation'
import { getAuthenticatedUser } from '@/middleware/auth'

// Types
import type { AppContext, SessionResumeRequest } from '@/types/api'
import { ErrorCode, AppError } from '@/types/errors'

// Utils
import { createLogger } from '@/config/environment'
import { CryptoUtils } from '@/utils/crypto'

const logger = createLogger('auth-routes')

// Create router
const router = new Hono<{ Variables: any }>()

// Registration endpoint
router.post(
  '/register',
  ValidationMiddleware.validateBody(schemas.registration),
  async (c: AppContext) => {
    try {
      const validatedBody = c.get('validatedBody') as {
        name: string
        email?: string
        phone?: string
        consentTerms: boolean
        consentPrivacy: boolean
        consentMarketing: boolean
      }
      const db = c.get('db')

      // Check for existing participant
      const existingParticipant = await db.select()
        .from(participants)
        .where(eq(participants.name, validatedBody.name))
        .limit(1)

      if (existingParticipant.length > 0) {
        throw new AppError(
          ErrorCode.DUPLICATE_RECORD,
          'Participant already exists',
          409
        )
      }

      // Create new participant
      const participantResult = await db.insert(participants).values({
        name: validatedBody.name,
        email: validatedBody.email,
        phone: validatedBody.phone,
        consentTerms: validatedBody.consentTerms,
        consentMarketing: validatedBody.consentMarketing
      }).returning()

      if (!participantResult[0] || !participantResult[0].id) {
        throw new AppError(
          ErrorCode.DATABASE_ERROR,
          'Failed to create participant',
          500
        )
      }

      const participantId = participantResult[0].id

      // Generate JWT token
      const token = await JWTService.generateToken({
        sub: participantId.toString(),
        name: validatedBody.name,
        email: validatedBody.email,
        role: 'user',
        permissions: ['quiz_participation']
      })

      // Log privacy activity
      const privacyService = new PrivacyService(db)
      await privacyService.logDataProcessing({
        participantId: participantId,
        activityType: 'registration',
        dataCategories: ['name', 'email', 'phone'],
        processingPurpose: 'quiz_participation',
        legalBasis: 'consent',
        retentionPeriod: 365
      })

      return c.json({
        success: true,
        data: {
          token,
          participant: {
            id: participantId,
            name: validatedBody.name,
            email: validatedBody.email
          }
        },
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      logger.error('Registration failed:', error)
      
      if (error instanceof AppError) {
        return c.json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          },
          timestamp: new Date().toISOString()
        }, error.statusCode as any)
      }

      return c.json({
        success: false,
        error: {
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: 'Registration failed'
        },
        timestamp: new Date().toISOString()
      }, 500)
    }
  }
)

// Admin login endpoint
router.post(
  '/admin/login',
  ValidationMiddleware.validateBody(schemas.adminLogin),
  async (c: AppContext) => {
    try {
      const { username, password } = c.get('validatedBody') as {
        username: string
        password: string
      }
      const db = c.get('db')

      // Find admin user
      const adminUser = await db.select()
        .from(adminUsers)
        .where(eq(adminUsers.username, username))
        .limit(1)

      if (adminUser.length === 0) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          'Invalid credentials',
          401
        )
      }

      // Verify password
      const isValidPassword = await CryptoUtils.verifyPassword(password, adminUser[0]!.passwordHash)
      if (!isValidPassword) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          'Invalid credentials',
          401
        )
      }

      // Generate JWT token
      const token = await JWTService.generateToken({
        sub: adminUser[0]!.id.toString(),
        name: adminUser[0]!.username,
        role: adminUser[0]!.role as 'admin' | 'super_admin',
        permissions: adminUser[0]!.permissions ? JSON.parse(adminUser[0]!.permissions) : []
      })

      return c.json({
        success: true,
        data: {
          token,
          user: {
            id: adminUser[0]!.id,
            username: adminUser[0]!.username,
            role: adminUser[0]!.role
          }
        },
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      logger.error('Admin login failed:', error)
      
      if (error instanceof AppError) {
        return c.json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          },
          timestamp: new Date().toISOString()
        }, error.statusCode as any)
      }

      return c.json({
        success: false,
        error: {
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: 'Login failed'
        },
        timestamp: new Date().toISOString()
      }, 500)
    }
  }
)

// Refresh token endpoint
router.post(
  '/refresh-token',
  ValidationMiddleware.validateBody(z.object({
    sessionId: z.string().uuid()
  })),
  async (c: AppContext) => {
    try {
      const user = getAuthenticatedUser(c)
      const { sessionId } = c.get('validatedBody') as { sessionId: string }
      const db = c.get('db')

      // Verify session belongs to user
      const sessions = await db.select()
        .from(quizSessions)
        .where(
          and(
            eq(quizSessions.id, sessionId),
            eq(quizSessions.participantId, parseInt(user.id))
          )
        )
        .limit(1)

      if (sessions.length === 0) {
        throw new AppError(
          ErrorCode.SESSION_NOT_FOUND,
          'Session not found',
          404
        )
      }

      // Generate new token
      const newToken = await JWTService.generateToken({
        sub: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        sessionId: sessionId
      })

      return c.json({
        success: true,
        data: {
          token: newToken,
          expiresIn: '24h'
        },
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      logger.error('Token refresh failed:', error)
      
      if (error instanceof AppError) {
        return c.json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          },
          timestamp: new Date().toISOString()
        }, error.statusCode as any)
      }

      return c.json({
        success: false,
        error: {
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: 'Token refresh failed'
        },
        timestamp: new Date().toISOString()
      }, 500)
    }
  }
)

// Session resume endpoint
router.post(
  '/session/resume',
  ValidationMiddleware.validateBody(schemas.sessionResume),
  async (c: AppContext) => {
    try {
      const user = getAuthenticatedUser(c)
      const { sessionId } = c.get('validatedBody') as SessionResumeRequest
      const db = c.get('db')

      // Get session state
      const session = await db.select()
        .from(quizSessions)
        .where(
          and(
            eq(quizSessions.id, sessionId),
            eq(quizSessions.participantId, parseInt(user.id))
          )
        )
        .limit(1)

      if (session.length === 0) {
        throw new AppError(
          ErrorCode.SESSION_NOT_FOUND,
          'Session not found',
          404
        )
      }

      // Check if session can be resumed
      const connectionRecoveryService = new ConnectionRecoveryService(db)
      const recoveryResult = await connectionRecoveryService.analyzeRecoveryOptions(
        sessionId,
        parseInt(user.id),
        1
      )

      return c.json({
        success: true,
        data: {
          canResume: recoveryResult.canResume,
          suggestedAction: recoveryResult.suggestedAction,
          sessionState: {
            id: session[0]!.id,
            status: session[0]!.status,
            currentQuestionIndex: session[0]!.currentQuestionIndex,
            totalScore: session[0]!.totalScore,
            questionsAnswered: session[0]!.questionsAnswered
          }
        },
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      logger.error('Session resume failed:', error)
      
      if (error instanceof AppError) {
        return c.json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          },
          timestamp: new Date().toISOString()
        }, error.statusCode as any)
      }

      return c.json({
        success: false,
        error: {
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: 'Session resume failed'
        },
        timestamp: new Date().toISOString()
      }, 500)
    }
  }
)

// Export router
export { router as authRoutes }
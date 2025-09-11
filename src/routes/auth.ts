/**
 * Authentication Routes
 * User registration, admin login, and token management
 */

import { Hono } from 'hono';
import { and, eq, or, sql } from 'drizzle-orm';

import { 
  participants, 
  adminUsers, 
  consentRecords, 
  dataProcessingActivities,
  quizSessions 
} from '@/db/schema';
import { JWTService, Permission, PermissionManager } from '@/services/JWTService';
import { ValidationMiddleware, schemas } from '@/middleware/ValidationMiddleware';
import { TokenService } from '@/services/TokenService';
import { ConnectionRecoveryService } from '@/services/ConnectionRecoveryService';
import { rateLimitMiddleware } from '@/middleware/RateLimitMiddleware';
import { authenticationMiddleware } from '@/middleware/RoleMiddleware';
import { InputSanitizer } from '@/middleware/ValidationMiddleware';
import { CryptoUtils } from '@/utils/crypto';
import { Environment } from '@/utils/environment';
import { Logger } from '@/utils/logger';
import { ErrorHandler, ErrorCode } from '@/utils/ErrorHandler';

import type { Context } from 'hono';
import type { DatabaseInstance } from '@/db/connection';
import type { Env } from '@/index';
import type { RegisterRequest } from '@/types/api';

/**
 * Admin login request interface
 */
interface AdminLoginRequest {
  username: string;
  password: string;
}

/**
 * Session resume request interface
 */
interface SessionResumeRequest {
  sessionId: string;
  lastEventId?: string;
}

/**
 * Authentication routes setup
 */
export function setupAuthRoutes(app: Hono<{ Bindings: Env }>) {
  const authGroup = app.basePath('/api');

  /**
   * User Registration Endpoint
   * POST /api/register
   */
  authGroup.post(
    '/register',
    rateLimitMiddleware, // Uses default registration rate limit
    ValidationMiddleware.validateBody(schemas.registration),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const validatedData = c.get('validatedBody') as RegisterRequest;
        const db = c.get('db') as DatabaseInstance;
        const clientIP = c.req.header('CF-Connecting-IP') || 'unknown';
        const userAgent = c.req.header('User-Agent') || 'unknown';

        // Check for existing participant
        if (validatedData.email || validatedData.phone) {
          const existing = await checkExistingParticipant(
            db,
            validatedData.email,
            validatedData.phone
          );

          if (existing) {
            return ErrorHandler.createErrorResponse(
              c,
              ErrorCode.CONFLICT,
              'Bu email veya telefon numarası ile kayıt zaten mevcut',
              409
            );
          }
        }

        // Create participant with transaction-like behavior
        const participantResult = await db
          .insert(participants)
          .values({
            name: validatedData.name,
            email: validatedData.email || undefined,
            phone: validatedData.phone ? 
              InputSanitizer.normalizePhoneNumber(validatedData.phone) : undefined,
            consentMarketing: validatedData.consentMarketing,
            consentTerms: validatedData.consentTerms,
          })
          .returning({ id: participants.id });

        const participantId = participantResult[0].id;

        // Record consent
        await recordConsent(db, participantId, {
          consentTerms: validatedData.consentTerms,
          consentMarketing: validatedData.consentMarketing,
          ipAddress: clientIP,
          userAgent: userAgent,
        });

        // Log data processing activity
        await logRegistrationActivity(db, participantId, clientIP);

        // Generate JWT token
        const tokenPair = await JWTService.generateTokenPair({
          sub: participantId.toString(),
          role: 'user',
          permissions: PermissionManager.getRolePermissions('user'),
          participantId: participantId,
        });

        // Audit log
        Logger.info('User registered successfully', {
          participantId,
          email: validatedData.email,
          hasPhone: !!validatedData.phone,
          consentMarketing: validatedData.consentMarketing,
          ip: clientIP,
        });

        return ErrorHandler.createSuccessResponse(c, {
          participantId,
          accessToken: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          expiresIn: tokenPair.expiresIn,
          tokenType: tokenPair.tokenType,
        }, 201);

      } catch (error) {
        Logger.error('Registration failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Admin Login Endpoint
   * POST /api/admin/login
   */
  authGroup.post(
    '/admin/login',
    rateLimitMiddleware, // Uses admin login rate limit
    ValidationMiddleware.validateBody(schemas.adminLogin),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const { username, password } = c.get('validatedBody') as AdminLoginRequest;
        const db = c.get('db') as DatabaseInstance;
        const clientIP = c.req.header('CF-Connecting-IP') || 'unknown';

        // Find admin user
        const adminResult = await db
          .select()
          .from(adminUsers)
          .where(
            and(
              eq(adminUsers.username, username),
              eq(adminUsers.isActive, true)
            )
          )
          .limit(1);

        const admin = adminResult[0];

        if (!admin) {
          Logger.warn('Admin login failed - user not found', {
            username,
            ip: clientIP,
          });

          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.UNAUTHORIZED,
            'Geçersiz kullanıcı adı veya şifre',
            401
          );
        }

        // Verify password
        const isValidPassword = await CryptoUtils.verifyPassword(password, admin.passwordHash);

        if (!isValidPassword) {
          Logger.warn('Admin login failed - invalid password', {
            username,
            adminId: admin.id,
            ip: clientIP,
          });

          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.UNAUTHORIZED,
            'Geçersiz kullanıcı adı veya şifre',
            401
          );
        }

        // Update last login
        await db
          .update(adminUsers)
          .set({ lastLoginAt: sql`(unixepoch())` })
          .where(eq(adminUsers.id, admin.id));

        // Generate admin JWT
        const permissions = JSON.parse(admin.permissions || '[]');
        const tokenPair = await JWTService.generateTokenPair({
          sub: admin.id.toString(),
          role: admin.role as 'admin' | 'super_admin',
          permissions: permissions,
        });

        // Audit log
        Logger.info('Admin logged in successfully', {
          adminId: admin.id,
          username: admin.username,
          role: admin.role,
          ip: clientIP,
        });

        return ErrorHandler.createSuccessResponse(c, {
          adminId: admin.id,
          username: admin.username,
          role: admin.role,
          permissions: permissions,
          accessToken: tokenPair.accessToken,
          expiresIn: tokenPair.expiresIn,
          tokenType: tokenPair.tokenType,
        });

      } catch (error) {
        Logger.error('Admin login failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Ephemeral Token for OpenAI Realtime API
   * GET /api/realtime/token?sessionId=uuid
   */
  authGroup.get(
    '/realtime/token',
    authenticationMiddleware,
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const sessionId = c.req.query('sessionId');

        if (!sessionId) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.BAD_REQUEST,
            'Session ID gerekli'
          );
        }

        // Verify session belongs to user
        const db = c.get('db') as DatabaseInstance;
        const sessionResult = await db
          .select()
          .from(quizSessions)
          .where(
            and(
              eq(quizSessions.id, sessionId),
              eq(quizSessions.participantId, parseInt(user.id))
            )
          )
          .limit(1);

        if (sessionResult.length === 0) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.NOT_FOUND,
            'Geçersiz session ID'
          );
        }

        // Generate ephemeral token using TokenService
        const ephemeralToken = await TokenService.generateEphemeralToken(
          sessionId,
          parseInt(user.id),
          ['realtime_audio', 'tool_dispatch']
        );

        Logger.info('Ephemeral token generated', {
          userId: user.id,
          sessionId: sessionId,
        });

        return ErrorHandler.createSuccessResponse(c, {
          clientSecret: ephemeralToken,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          sessionId: sessionId,
        });

      } catch (error) {
        Logger.error('Ephemeral token generation failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Token Refresh Endpoint
   * POST /api/realtime/refresh-token
   */
  authGroup.post(
    '/realtime/refresh-token',
    authenticationMiddleware,
    ValidationMiddleware.validateBody(schemas.refreshToken || 
      schemas.toolDispatch.pick({ sessionId: true })),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const { sessionId } = c.get('validatedBody') as { sessionId: string };
        const db = c.get('db') as DatabaseInstance;

        // Verify session is still active
        const sessionResult = await db
          .select()
          .from(quizSessions)
          .where(
            and(
              eq(quizSessions.id, sessionId),
              eq(quizSessions.participantId, parseInt(user.id)),
              eq(quizSessions.status, 'active')
            )
          )
          .limit(1);

        if (sessionResult.length === 0) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.SESSION_EXPIRED,
            'Session artık aktif değil'
          );
        }

        // Generate new ephemeral token using TokenService
        const refreshResult = await TokenService.refreshEphemeralToken(
          c.req.header('Authorization')?.replace('Bearer ', '') || '',
          sessionId
        );
        
        if (!refreshResult.newToken) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.TOKEN_REFRESH_FAILED,
            refreshResult.error || 'Token yenilenemedi'
          );
        }
        
        const newToken = refreshResult.newToken;

        Logger.info('Token refreshed', {
          userId: user.id,
          sessionId: sessionId,
        });

        return ErrorHandler.createSuccessResponse(c, {
          newClientSecret: newToken,
          newExpiresAt: new Date(Date.now() + 300000).toISOString(),
        });

      } catch (error) {
        Logger.error('Token refresh failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Session Resume Endpoint (Connection Recovery)
   * POST /api/session/resume
   */
  authGroup.post(
    '/session/resume',
    authenticationMiddleware,
    ValidationMiddleware.validateBody(
      schemas.toolDispatch.pick({ sessionId: true }).extend({
        lastEventId: schemas.toolDispatch.shape.sessionId.optional()
      })
    ),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const { sessionId, lastEventId } = c.get('validatedBody') as SessionResumeRequest;
        const db = c.get('db') as DatabaseInstance;

        // Initialize ConnectionRecoveryService
        const recoveryService = new ConnectionRecoveryService(db);

        // Attempt session recovery
        const recoveryResult = await recoveryService.attemptReconnection(
          sessionId,
          parseInt(user.id)
        );

        if (!recoveryResult.success) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.SESSION_RESUME_FAILED,
            recoveryResult.error || 'Session devam ettirilemedi',
            {
              canResume: recoveryResult.canResume,
              suggestedAction: recoveryResult.suggestedAction
            }
          );
        }

        const sessionState = recoveryResult.sessionState!;

        Logger.info('Session resumed', {
          userId: user.id,
          sessionId: sessionId,
          sessionStatus: sessionState.status,
        });

        return ErrorHandler.createSuccessResponse(c, {
          sessionState: {
            sessionId: sessionState.id,
            status: sessionState.status,
            totalScore: sessionState.totalScore,
            currentQuestionIndex: sessionState.currentQuestionIndex,
          },
          canContinue: sessionState.status === 'active',
        });

      } catch (error) {
        Logger.error('Session resume failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Logout Endpoint
   * POST /api/logout
   */
  authGroup.post(
    '/logout',
    authenticationMiddleware,
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const authHeader = c.req.header('Authorization');
        
        if (authHeader) {
          const token = JWTService.extractTokenFromHeader(authHeader);
          await JWTService.revokeToken(token);
        }

        Logger.info('User logged out', {
          userId: c.get('user')?.id,
        });

        return ErrorHandler.createSuccessResponse(c, {
          message: 'Başarıyla çıkış yapıldı',
        });

      } catch (error) {
        Logger.error('Logout failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );
}

/**
 * Helper function to check for existing participant
 */
async function checkExistingParticipant(
  db: DatabaseInstance,
  email?: string,
  phone?: string
): Promise<boolean> {
  if (!email && !phone) return false;

  const conditions = [];
  if (email) conditions.push(eq(participants.email, email));
  if (phone) conditions.push(eq(participants.phone, phone));

  const existingResult = await db
    .select({ id: participants.id })
    .from(participants)
    .where(or(...conditions))
    .limit(1);

  return existingResult.length > 0;
}

/**
 * Helper function to record user consent
 */
async function recordConsent(
  db: DatabaseInstance,
  participantId: number,
  consentData: {
    consentTerms: boolean;
    consentMarketing: boolean;
    ipAddress: string;
    userAgent: string;
  }
): Promise<void> {
  const consentVersion = '1.0';

  // Terms of service consent
  await db.insert(consentRecords).values({
    participantId,
    consentType: 'terms_of_service',
    consentGiven: consentData.consentTerms,
    consentVersion,
    ipAddress: consentData.ipAddress,
    userAgent: consentData.userAgent,
  });

  // Marketing communications consent
  await db.insert(consentRecords).values({
    participantId,
    consentType: 'marketing_communications',
    consentGiven: consentData.consentMarketing,
    consentVersion,
    ipAddress: consentData.ipAddress,
    userAgent: consentData.userAgent,
  });
}

/**
 * Helper function to log registration activity for KVKK compliance
 */
async function logRegistrationActivity(
  db: DatabaseInstance,
  participantId: number,
  ipAddress: string
): Promise<void> {
  await db.insert(dataProcessingActivities).values({
    participantId,
    activityType: 'registration',
    dataCategories: JSON.stringify(['personal_data']),
    processingPurpose: 'Kullanıcı kaydı ve yarışma katılımı',
    legalBasis: 'Kullanıcı rızası (KVKK 6. madde)',
    retentionPeriod: Environment.getDataRetentionDays(),
    isAutomated: true,
  });
}

/**
 * Helper function to get session state
 */
async function getSessionState(
  db: DatabaseInstance,
  sessionId: string,
  participantId: number
) {
  const sessionResult = await db
    .select()
    .from(quizSessions)
    .where(
      and(
        eq(quizSessions.id, sessionId),
        eq(quizSessions.participantId, participantId)
      )
    )
    .limit(1);

  return sessionResult[0] || null;
}

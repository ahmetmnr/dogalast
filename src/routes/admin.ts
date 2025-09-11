/**
 * Admin Routes
 * Question management, user management, and system administration
 */

import { Hono } from 'hono';
import { eq, and, sql, desc, asc, like, or } from 'drizzle-orm';
import { z } from 'zod';

import { 
  questions,
  participants,
  quizSessions,
  auditLogs,
  systemSettings,
  adminUsers
} from '@/db/schema';
import { ValidationMiddleware, schemas } from '@/middleware/ValidationMiddleware';
import { rateLimitMiddleware } from '@/middleware/RateLimitMiddleware';
import { authenticationMiddleware, AuthorizationMiddleware } from '@/middleware/RoleMiddleware';
import { Permission } from '@/services/JWTService';
import { PrivacyService } from '@/services/PrivacyService';
import { CryptoUtils } from '@/utils/crypto';
import { Logger } from '@/utils/logger';
import { ErrorHandler, ErrorCode } from '@/utils/ErrorHandler';
import { db as dbHelpers } from '@/db/connection';

import type { Context } from 'hono';
import type { DatabaseInstance } from '@/db/connection';
import type { Env } from '@/index';

/**
 * Question creation request
 */
interface QuestionCreateRequest {
  text: string;
  correctAnswer: string;
  options?: string[];
  difficulty: number;
  basePoints: number;
  timeLimit: number;
  category: string;
}

/**
 * User management request
 */
interface UserManagementRequest {
  action: 'ban' | 'unban' | 'delete_data' | 'export_data';
  reason?: string;
}

/**
 * Admin routes setup
 */
export function setupAdminRoutes(app: Hono<{ Bindings: Env }>) {
  const adminGroup = app.basePath('/api/admin');

  /**
   * Question Management - List Questions
   * GET /api/admin/questions?page=1&pageSize=10&search=query
   */
  adminGroup.get(
    '/questions',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.VIEW_QUESTIONS),
    ValidationMiddleware.validateQuery(z.object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      pageSize: z.string().regex(/^\d+$/).transform(Number).optional().default('10'),
      search: z.string().optional(),
      category: z.string().optional(),
      difficulty: z.string().regex(/^[1-5]$/).transform(Number).optional(),
      active: z.enum(['true', 'false']).optional(),
    })),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const db = c.get('db') as DatabaseInstance;
        const query = c.get('validatedQuery') as {
          page: number;
          pageSize: number;
          search?: string;
          category?: string;
          difficulty?: number;
          active?: string;
        };

        const { page, pageSize, search, category, difficulty, active } = query;
        const offset = (page - 1) * pageSize;

        // Build where conditions
        const conditions = [];
        
        if (search) {
          conditions.push(
            or(
              like(questions.text, `%${search}%`),
              like(questions.correctAnswer, `%${search}%`)
            )
          );
        }
        
        if (category) {
          conditions.push(eq(questions.category, category));
        }
        
        if (difficulty) {
          conditions.push(eq(questions.difficulty, difficulty));
        }
        
        if (active === 'true') {
          conditions.push(eq(questions.isActive, true));
        } else if (active === 'false') {
          conditions.push(eq(questions.isActive, false));
        }

        // Get questions with pagination
        const questionsQuery = db
          .select()
          .from(questions)
          .orderBy(questions.orderNo);

        if (conditions.length > 0) {
          questionsQuery.where(and(...conditions));
        }

        const allQuestions = await questionsQuery;
        const paginatedQuestions = allQuestions.slice(offset, offset + pageSize);

        // Format response
        const formattedQuestions = paginatedQuestions.map(q => ({
          ...q,
          options: q.options ? JSON.parse(q.options) : null,
          createdAt: new Date(q.createdAt).toISOString(),
          updatedAt: new Date(q.updatedAt).toISOString(),
        }));

        return ErrorHandler.createSuccessResponse(c, {
          questions: formattedQuestions,
          pagination: {
            page,
            pageSize,
            total: allQuestions.length,
            totalPages: Math.ceil(allQuestions.length / pageSize),
            hasMore: offset + pageSize < allQuestions.length,
          },
        });

      } catch (error) {
        Logger.error('Admin questions list failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Question Management - Create Question
   * POST /api/admin/questions
   */
  adminGroup.post(
    '/questions',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.CREATE_QUESTIONS),
    ValidationMiddleware.validateBody(schemas.question),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const questionData = c.get('validatedBody') as QuestionCreateRequest;
        const db = c.get('db') as DatabaseInstance;

        // Get next order number
        const lastOrderResult = await db
          .select({ maxOrder: sql<number>`MAX(${questions.orderNo})` })
          .from(questions);

        const nextOrderNo = (lastOrderResult[0]?.maxOrder || 0) + 1;

        // Create question
        const questionId = dbHelpers.generateId();
        
        await db.insert(questions).values({
          id: questionId,
          orderNo: nextOrderNo,
          text: questionData.text,
          correctAnswer: questionData.correctAnswer,
          options: questionData.options ? JSON.stringify(questionData.options) : undefined,
          difficulty: questionData.difficulty,
          basePoints: questionData.basePoints,
          timeLimit: questionData.timeLimit,
          category: questionData.category,
          isActive: true,
        });

        // Audit log
        await db.insert(auditLogs).values({
          tableName: 'questions',
          recordId: questionId,
          action: 'INSERT',
          newValues: JSON.stringify(questionData),
          adminUserId: parseInt(user.id),
          privacyImpact: 'content_management',
        });

        Logger.info('Question created by admin', {
          adminId: user.id,
          questionId,
          orderNo: nextOrderNo,
        });

        return ErrorHandler.createSuccessResponse(c, {
          questionId,
          orderNo: nextOrderNo,
          message: 'Soru başarıyla oluşturuldu',
        }, 201);

      } catch (error) {
        Logger.error('Question creation failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Question Management - Update Question
   * PUT /api/admin/questions/:id
   */
  adminGroup.put(
    '/questions/:id',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.UPDATE_QUESTIONS),
    ValidationMiddleware.validateBody(schemas.question.partial()),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const questionId = c.req.param('id');
        const updates = c.get('validatedBody') as Partial<QuestionCreateRequest>;
        const db = c.get('db') as DatabaseInstance;

        // Check if question exists
        const existingQuestionResult = await db
          .select()
          .from(questions)
          .where(eq(questions.id, questionId))
          .limit(1);

        const existingQuestion = existingQuestionResult[0];

        if (!existingQuestion) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.NOT_FOUND,
            'Soru bulunamadı'
          );
        }

        // Prepare update data
        const updateData: any = {
          updatedAt: sql`(unixepoch())`,
        };

        if (updates.text) updateData.text = updates.text;
        if (updates.correctAnswer) updateData.correctAnswer = updates.correctAnswer;
        if (updates.options) updateData.options = JSON.stringify(updates.options);
        if (updates.difficulty) updateData.difficulty = updates.difficulty;
        if (updates.basePoints) updateData.basePoints = updates.basePoints;
        if (updates.timeLimit) updateData.timeLimit = updates.timeLimit;
        if (updates.category) updateData.category = updates.category;

        // Update question
        await db
          .update(questions)
          .set(updateData)
          .where(eq(questions.id, questionId));

        // Audit log
        await db.insert(auditLogs).values({
          tableName: 'questions',
          recordId: questionId,
          action: 'UPDATE',
          oldValues: JSON.stringify(existingQuestion),
          newValues: JSON.stringify(updates),
          adminUserId: parseInt(user.id),
          privacyImpact: 'content_management',
        });

        Logger.info('Question updated by admin', {
          adminId: user.id,
          questionId,
          updates: Object.keys(updates),
        });

        return ErrorHandler.createSuccessResponse(c, {
          questionId,
          message: 'Soru başarıyla güncellendi',
        });

      } catch (error) {
        Logger.error('Question update failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Question Management - Delete Question (Soft Delete)
   * DELETE /api/admin/questions/:id
   */
  adminGroup.delete(
    '/questions/:id',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.DELETE_QUESTIONS),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const questionId = c.req.param('id');
        const db = c.get('db') as DatabaseInstance;

        // Check if question exists and is active
        const questionResult = await db
          .select()
          .from(questions)
          .where(eq(questions.id, questionId))
          .limit(1);

        const question = questionResult[0];

        if (!question) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.NOT_FOUND,
            'Soru bulunamadı'
          );
        }

        // Soft delete (deactivate)
        await db
          .update(questions)
          .set({
            isActive: false,
            updatedAt: sql`(unixepoch())`,
          })
          .where(eq(questions.id, questionId));

        // Audit log
        await db.insert(auditLogs).values({
          tableName: 'questions',
          recordId: questionId,
          action: 'DELETE',
          oldValues: JSON.stringify(question),
          adminUserId: parseInt(user.id),
          privacyImpact: 'content_management',
        });

        Logger.info('Question deleted by admin', {
          adminId: user.id,
          questionId,
          questionText: question.text.substring(0, 50),
        });

        return ErrorHandler.createSuccessResponse(c, {
          questionId,
          message: 'Soru başarıyla silindi',
        });

      } catch (error) {
        Logger.error('Question deletion failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * User Management - List Participants
   * GET /api/admin/users?page=1&pageSize=10&search=query
   */
  adminGroup.get(
    '/users',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.VIEW_USERS),
    ValidationMiddleware.validateQuery(z.object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      pageSize: z.string().regex(/^\d+$/).transform(Number).optional().default('10'),
      search: z.string().optional(),
    })),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const db = c.get('db') as DatabaseInstance;
        const query = c.get('validatedQuery') as {
          page: number;
          pageSize: number;
          search?: string;
        };

        const { page, pageSize, search } = query;
        const offset = (page - 1) * pageSize;

        // Build query
        let participantsQuery = db
          .select({
            id: participants.id,
            name: participants.name,
            email: participants.email,
            phone: participants.phone,
            consentMarketing: participants.consentMarketing,
            consentTerms: participants.consentTerms,
            createdAt: participants.createdAt,
            // Quiz statistics
            totalSessions: sql<number>`COUNT(${quizSessions.id})`,
            completedSessions: sql<number>`SUM(CASE WHEN ${quizSessions.status} = 'completed' THEN 1 ELSE 0 END)`,
            bestScore: sql<number>`MAX(${quizSessions.totalScore})`,
          })
          .from(participants)
          .leftJoin(quizSessions, eq(participants.id, quizSessions.participantId))
          .groupBy(participants.id);

        if (search) {
          participantsQuery = participantsQuery.where(
            or(
              like(participants.name, `%${search}%`),
              like(participants.email, `%${search}%`),
              like(participants.phone, `%${search}%`)
            )
          );
        }

        const allParticipants = await participantsQuery
          .orderBy(desc(participants.createdAt));

        const paginatedParticipants = allParticipants.slice(offset, offset + pageSize);

        // Format response (mask sensitive data for regular admins)
        const user = c.get('user');
        const isSuperAdmin = user.role === 'super_admin';

        const formattedParticipants = paginatedParticipants.map(p => ({
          id: p.id,
          name: p.name,
          email: isSuperAdmin ? p.email : (p.email ? '***@***.com' : null),
          phone: isSuperAdmin ? p.phone : (p.phone ? '***********' : null),
          consentMarketing: p.consentMarketing,
          consentTerms: p.consentTerms,
          createdAt: new Date(p.createdAt).toISOString(),
          statistics: {
            totalSessions: p.totalSessions,
            completedSessions: p.completedSessions,
            bestScore: p.bestScore || 0,
          },
        }));

        return ErrorHandler.createSuccessResponse(c, {
          participants: formattedParticipants,
          pagination: {
            page,
            pageSize,
            total: allParticipants.length,
            totalPages: Math.ceil(allParticipants.length / pageSize),
          },
        });

      } catch (error) {
        Logger.error('Admin users list failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * User Management - Manage User
   * POST /api/admin/users/:id/manage
   */
  adminGroup.post(
    '/users/:id/manage',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.MANAGE_USERS),
    ValidationMiddleware.validateBody(z.object({
      action: z.enum(['ban', 'unban', 'delete_data', 'export_data']),
      reason: z.string().optional(),
    })),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const participantId = parseInt(c.req.param('id'));
        const { action, reason } = c.get('validatedBody') as UserManagementRequest;
        const db = c.get('db') as DatabaseInstance;

        // Verify participant exists
        const participantResult = await db
          .select()
          .from(participants)
          .where(eq(participants.id, participantId))
          .limit(1);

        if (participantResult.length === 0) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.NOT_FOUND,
            'Kullanıcı bulunamadı'
          );
        }

        const participant = participantResult[0];

        switch (action) {
          case 'export_data':
            // Generate privacy report
            const privacyService = new PrivacyService(db);
            const privacyReport = await privacyService.generatePrivacyReport(participantId);

            // Audit log
            await db.insert(auditLogs).values({
              tableName: 'participants',
              recordId: participantId.toString(),
              action: 'SELECT',
              adminUserId: parseInt(user.id),
              privacyImpact: 'data_export',
            });

            return ErrorHandler.createSuccessResponse(c, {
              action,
              participantId,
              privacyReport,
              message: 'Veri raporu oluşturuldu',
            });

          case 'delete_data':
            // Only super_admin can delete data
            if (user.role !== 'super_admin') {
              return ErrorHandler.createErrorResponse(
                c,
                ErrorCode.FORBIDDEN,
                'Veri silme işlemi için super admin yetkisi gerekli'
              );
            }

            // Process data deletion
            const privacyServiceForDeletion = new PrivacyService(db);
            await privacyServiceForDeletion.anonymizeData(participantId, ['personal_data']);

            // Audit log
            await db.insert(auditLogs).values({
              tableName: 'participants',
              recordId: participantId.toString(),
              action: 'DELETE',
              oldValues: JSON.stringify(participant),
              adminUserId: parseInt(user.id),
              privacyImpact: 'data_deletion',
            });

            return ErrorHandler.createSuccessResponse(c, {
              action,
              participantId,
              message: 'Kullanıcı verisi anonimleştirildi',
            });

          default:
            return ErrorHandler.createErrorResponse(
              c,
              ErrorCode.BAD_REQUEST,
              'Desteklenmeyen işlem'
            );
        }

      } catch (error) {
        Logger.error('User management action failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * System Statistics
   * GET /api/admin/stats
   */
  adminGroup.get(
    '/stats',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.VIEW_ANALYTICS),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const db = c.get('db') as DatabaseInstance;

        // Get system statistics
        const stats = await Promise.all([
          // Total participants
          db.select({ count: sql<number>`COUNT(*)` }).from(participants),
          
          // Active sessions
          db.select({ count: sql<number>`COUNT(*)` })
            .from(quizSessions)
            .where(eq(quizSessions.status, 'active')),
          
          // Completed sessions
          db.select({ count: sql<number>`COUNT(*)` })
            .from(quizSessions)
            .where(eq(quizSessions.status, 'completed')),
          
          // Total questions
          db.select({ count: sql<number>`COUNT(*)` })
            .from(questions)
            .where(eq(questions.isActive, true)),
        ]);

        const systemStats = {
          participants: {
            total: stats[0][0]?.count || 0,
          },
          sessions: {
            active: stats[1][0]?.count || 0,
            completed: stats[2][0]?.count || 0,
          },
          questions: {
            active: stats[3][0]?.count || 0,
          },
          system: {
            uptime: process.uptime ? process.uptime() : 0,
            timestamp: new Date().toISOString(),
          },
        };

        return ErrorHandler.createSuccessResponse(c, systemStats);

      } catch (error) {
        Logger.error('Admin stats fetch failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Audit Logs
   * GET /api/admin/audit-logs?page=1&pageSize=20
   */
  adminGroup.get(
    '/audit-logs',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.VIEW_AUDIT_LOGS),
    ValidationMiddleware.validateQuery(z.object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      pageSize: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
      tableName: z.string().optional(),
      action: z.enum(['INSERT', 'UPDATE', 'DELETE', 'SELECT']).optional(),
    })),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const db = c.get('db') as DatabaseInstance;
        const query = c.get('validatedQuery') as {
          page: number;
          pageSize: number;
          tableName?: string;
          action?: string;
        };

        const { page, pageSize, tableName, action } = query;
        const offset = (page - 1) * pageSize;

        // Build where conditions
        const conditions = [];
        if (tableName) conditions.push(eq(auditLogs.tableName, tableName));
        if (action) conditions.push(eq(auditLogs.action, action as any));

        // Get audit logs
        let auditQuery = db
          .select({
            id: auditLogs.id,
            tableName: auditLogs.tableName,
            recordId: auditLogs.recordId,
            action: auditLogs.action,
            adminUserId: auditLogs.adminUserId,
            participantId: auditLogs.participantId,
            privacyImpact: auditLogs.privacyImpact,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .orderBy(desc(auditLogs.createdAt));

        if (conditions.length > 0) {
          auditQuery = auditQuery.where(and(...conditions));
        }

        const allLogs = await auditQuery;
        const paginatedLogs = allLogs.slice(offset, offset + pageSize);

        const formattedLogs = paginatedLogs.map(log => ({
          ...log,
          createdAt: new Date(log.createdAt).toISOString(),
        }));

        return ErrorHandler.createSuccessResponse(c, {
          auditLogs: formattedLogs,
          pagination: {
            page,
            pageSize,
            total: allLogs.length,
            totalPages: Math.ceil(allLogs.length / pageSize),
          },
        });

      } catch (error) {
        Logger.error('Audit logs fetch failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * System Settings Management
   * GET /api/admin/settings
   */
  adminGroup.get(
    '/settings',
    authenticationMiddleware,
    AuthorizationMiddleware.requirePermission(Permission.MANAGE_SETTINGS),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const db = c.get('db') as DatabaseInstance;

        const settings = await db
          .select()
          .from(systemSettings)
          .orderBy(systemSettings.category, systemSettings.key);

        const groupedSettings = settings.reduce((acc, setting) => {
          const category = setting.category;
          if (!acc[category]) {
            acc[category] = [];
          }
          
          acc[category].push({
            key: setting.key,
            value: setting.value,
            description: setting.description,
            isEnvironmentVariable: setting.isEnvironmentVariable,
            updatedAt: new Date(setting.updatedAt).toISOString(),
          });
          
          return acc;
        }, {} as Record<string, any[]>);

        return ErrorHandler.createSuccessResponse(c, {
          settings: groupedSettings,
          categories: Object.keys(groupedSettings),
        });

      } catch (error) {
        Logger.error('System settings fetch failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );
}

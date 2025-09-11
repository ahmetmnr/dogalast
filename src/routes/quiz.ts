/**
 * Quiz Routes
 * Quiz flow management, tool dispatch, and leaderboard endpoints
 */

import { Hono } from 'hono';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { z } from 'zod';

import { 
  quizSessions,
  sessionQuestions,
  questions,
  participants
} from '@/db/schema';
import { SecureToolHandler, ToolExecutionError } from '@/services/SecureToolHandler';
import { ScoringService } from '@/services/ScoringService';
import { ValidationMiddleware, schemas } from '@/middleware/ValidationMiddleware';
import { rateLimitMiddleware } from '@/middleware/RateLimitMiddleware';
import { authenticationMiddleware } from '@/middleware/RoleMiddleware';
import { Logger } from '@/utils/logger';
import { ErrorHandler, ErrorCode } from '@/utils/ErrorHandler';

import type { Context } from 'hono';
import type { DatabaseInstance } from '@/db/connection';
import type { Env } from '@/index';
import type { ToolRequest } from '@/types/api';

/**
 * Tool dispatch request interface
 */
interface ToolDispatchRequest {
  tool: string;
  args: Record<string, any>;
  sessionId?: string;
  idempotencyKey?: string;
}

/**
 * Quiz routes setup
 */
export function setupQuizRoutes(app: Hono<{ Bindings: Env }>) {
  const quizGroup = app.basePath('/api');

  /**
   * Tool Dispatch Endpoint - Core of the quiz system
   * POST /api/tools/dispatch
   */
  quizGroup.post(
    '/tools/dispatch',
    rateLimitMiddleware, // Uses tool dispatch rate limit
    authenticationMiddleware,
    ValidationMiddleware.validateBody(schemas.toolDispatch),
    async (c: Context<{ Bindings: Env }>) => {
      const startTime = Date.now();

      try {
        const user = c.get('user');
        const validatedBody = c.get('validatedBody') as ToolDispatchRequest;
        const { tool, args, sessionId } = validatedBody;
        const db = c.get('db') as DatabaseInstance;

        // Get idempotency key from header
        const idempotencyKey = c.req.header('Idempotency-Key');

        // Create secure tool handler
        const toolHandler = new SecureToolHandler(db, user);

        // Check idempotency (prevent double submission)
        if (idempotencyKey) {
          const existingResult = await toolHandler.checkIdempotency(idempotencyKey);
          if (existingResult) {
            Logger.info('Idempotent tool call returned cached result', {
              userId: user.id,
              tool,
              idempotencyKey,
            });

            return ErrorHandler.createSuccessResponse(c, {
              ...existingResult,
              timing: {
                serverTimestamp: Date.now(),
                processingTime: 0, // Cached result
              },
            });
          }
        }

        // Validate session (if required by tool)
        if (sessionId) {
          const isValidSession = await toolHandler.validateSession(sessionId);
          if (!isValidSession) {
            return ErrorHandler.createErrorResponse(
              c,
              ErrorCode.FORBIDDEN,
              'Geçersiz veya erişim izni olmayan session'
            );
          }
        }

        // Execute tool
        const result = await toolHandler.executeTool(tool, args, sessionId);

        // Store idempotency result (if key provided)
        if (idempotencyKey) {
          await toolHandler.storeIdempotencyResult(idempotencyKey, result);
        }

        const processingTime = Date.now() - startTime;

        Logger.info('Tool executed successfully', {
          userId: user.id,
          tool,
          sessionId,
          processingTime,
        });

        return ErrorHandler.createSuccessResponse(c, {
          ...result,
          timing: {
            serverTimestamp: Date.now(),
            processingTime,
          },
        });

      } catch (error) {
        const processingTime = Date.now() - startTime;

        if (error instanceof ToolExecutionError) {
          Logger.warn('Tool execution failed', {
            userId: c.get('user')?.id,
            tool: c.get('validatedBody')?.tool,
            error: error.message,
            code: error.code,
          });

          return c.json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
            timing: {
              serverTimestamp: Date.now(),
              processingTime,
            },
            timestamp: new Date().toISOString(),
          }, error.statusCode || 400);
        }

        Logger.error('Tool dispatch failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Leaderboard Endpoint
   * GET /api/leaderboard?limit=10&offset=0
   */
  quizGroup.get(
    '/leaderboard',
    rateLimitMiddleware, // Uses leaderboard rate limit
    ValidationMiddleware.validateQuery(schemas.leaderboardQuery),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const db = c.get('db') as DatabaseInstance;
        const validatedQuery = c.get('validatedQuery') as {
          limit: number;
          offset: number;
          period: string;
        };

        const { limit, offset } = validatedQuery;

        if (limit > 50) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.BAD_REQUEST,
            'Limit maksimum 50 olabilir'
          );
        }

        const scoringService = new ScoringService(db);
        const fullLeaderboard = await scoringService.getLeaderboard(limit + offset);

        // Apply pagination
        const paginatedLeaderboard = fullLeaderboard.slice(offset, offset + limit);

        return ErrorHandler.createSuccessResponse(c, {
          leaderboard: paginatedLeaderboard,
          pagination: {
            limit,
            offset,
            total: fullLeaderboard.length,
            hasMore: offset + limit < fullLeaderboard.length,
          },
          generatedAt: new Date().toISOString(),
        });

      } catch (error) {
        Logger.error('Leaderboard fetch failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Quiz Start Endpoint
   * POST /api/quiz/start
   */
  quizGroup.post(
    '/quiz/start',
    authenticationMiddleware,
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const db = c.get('db') as DatabaseInstance;

        // Use tool handler for consistency
        const toolHandler = new SecureToolHandler(db, user);
        const result = await toolHandler.executeTool('startQuiz', {});

        return ErrorHandler.createSuccessResponse(c, result, 201);

      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return c.json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
            timestamp: new Date().toISOString(),
          }, error.statusCode);
        }

        Logger.error('Quiz start failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Quiz Finish Endpoint
   * POST /api/quiz/finish
   */
  quizGroup.post(
    '/quiz/finish',
    authenticationMiddleware,
    ValidationMiddleware.validateBody(z.object({
      sessionId: z.string().uuid('Geçersiz session ID'),
    })),
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const user = c.get('user');
        const { sessionId } = c.get('validatedBody') as { sessionId: string };
        const db = c.get('db') as DatabaseInstance;

        // Use tool handler for consistency
        const toolHandler = new SecureToolHandler(db, user);
        const result = await toolHandler.executeTool('finishQuiz', {}, sessionId);

        return ErrorHandler.createSuccessResponse(c, result);

      } catch (error) {
        if (error instanceof ToolExecutionError) {
          return c.json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
            timestamp: new Date().toISOString(),
          }, error.statusCode);
        }

        Logger.error('Quiz finish failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Question Details Endpoint (for debugging/admin)
   * GET /api/questions/:id
   */
  quizGroup.get(
    '/questions/:id',
    authenticationMiddleware,
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const questionId = c.req.param('id');
        const user = c.get('user');
        const db = c.get('db') as DatabaseInstance;

        // Only admins can view question details
        if (user.role === 'user') {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.FORBIDDEN,
            'Bu endpoint için yetkiniz yok'
          );
        }

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

        return ErrorHandler.createSuccessResponse(c, {
          question: {
            ...question,
            options: question.options ? JSON.parse(question.options) : null,
          },
        });

      } catch (error) {
        Logger.error('Question fetch failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Session Status Endpoint
   * GET /api/session/:sessionId/status
   */
  quizGroup.get(
    '/session/:sessionId/status',
    authenticationMiddleware,
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const sessionId = c.req.param('sessionId');
        const user = c.get('user');
        const db = c.get('db') as DatabaseInstance;

        // Verify session ownership
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

        const session = sessionResult[0];

        if (!session) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.NOT_FOUND,
            'Session bulunamadı'
          );
        }

        // Get current question info
        let currentQuestion = null;
        if (session.status === 'active') {
          const currentQuestionResult = await db
            .select({
              sessionQuestionId: sessionQuestions.id,
              questionText: questions.text,
              timeLimit: questions.timeLimit,
              presentedAt: sessionQuestions.presentedAt,
            })
            .from(sessionQuestions)
            .innerJoin(questions, eq(sessionQuestions.questionId, questions.id))
            .where(
              and(
                eq(sessionQuestions.sessionId, sessionId),
                eq(sessionQuestions.orderInSession, session.currentQuestionIndex + 1)
              )
            )
            .limit(1);

          currentQuestion = currentQuestionResult[0] || null;
        }

        return ErrorHandler.createSuccessResponse(c, {
          sessionId: session.id,
          status: session.status,
          totalScore: session.totalScore,
          currentQuestionIndex: session.currentQuestionIndex,
          startedAt: new Date(session.startedAt).toISOString(),
          completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : null,
          currentQuestion,
        });

      } catch (error) {
        Logger.error('Session status fetch failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );

  /**
   * Timing Analysis Endpoint (for debugging)
   * GET /api/quiz/timing-analysis/:sessionQuestionId
   */
  quizGroup.get(
    '/quiz/timing-analysis/:sessionQuestionId',
    authenticationMiddleware,
    async (c: Context<{ Bindings: Env }>) => {
      try {
        const sessionQuestionId = c.req.param('sessionQuestionId');
        const user = c.get('user');
        const db = c.get('db') as DatabaseInstance;

        // Only admins can view detailed timing analysis
        if (user.role === 'user') {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.FORBIDDEN,
            'Bu endpoint için yetkiniz yok'
          );
        }

        const { TimingService } = await import('@/services/TimingService');
        const timingService = new TimingService(db);
        const timingBreakdown = await timingService.getTimingBreakdown(sessionQuestionId);

        if (!timingBreakdown) {
          return ErrorHandler.createErrorResponse(
            c,
            ErrorCode.NOT_FOUND,
            'Timing bilgisi bulunamadı'
          );
        }

        return ErrorHandler.createSuccessResponse(c, {
          sessionQuestionId,
          timingBreakdown,
        });

      } catch (error) {
        Logger.error('Timing analysis fetch failed', error as Error);
        return ErrorHandler.handle(error, c);
      }
    }
  );
}

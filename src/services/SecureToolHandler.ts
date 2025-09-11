/**
 * Secure Tool Handler
 * Validates and executes tool calls with security and state consistency
 */

import { eq, and, sql, desc, asc } from 'drizzle-orm';

import { 
  quizSessions,
  sessionQuestions,
  questions,
  systemSettings,
  auditLogs
} from '@/db/schema';
import { TimingService } from './TimingService';
import { ScoringService } from './ScoringService';
import { PrivacyService } from './PrivacyService';
import { Logger } from '@/utils/logger';
import { db as dbHelpers } from '@/db/connection';

import type { DatabaseInstance } from '@/db/connection';
import type { UserContext } from '@/middleware/RoleMiddleware';

/**
 * Tool definition interface
 */
interface ToolDefinition {
  name: string;
  requiresSession: boolean;
  allowedStates: string[];
  rateLimit?: {
    limit: number;
    windowMs: number;
  };
  validator: (args: any) => boolean;
  executor: (handler: SecureToolHandler, args: any, sessionId?: string) => Promise<any>;
}

/**
 * Idempotency record for preventing duplicate operations
 */
interface IdempotencyRecord {
  key: string;
  result: any;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Tool execution error
 */
export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public code: string = 'TOOL_EXECUTION_ERROR',
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

/**
 * Secure Tool Handler class
 */
export class SecureToolHandler {
  private db: DatabaseInstance;
  private user: UserContext;
  private timingService: TimingService;
  private scoringService: ScoringService;
  private privacyService: PrivacyService;
  private idempotencyCache = new Map<string, IdempotencyRecord>();
  private logger: Logger;

  constructor(db: DatabaseInstance, user: UserContext) {
    this.db = db;
    this.user = user;
    this.timingService = new TimingService(db);
    this.scoringService = new ScoringService(db);
    this.privacyService = new PrivacyService(db);
    this.logger = new Logger('SecureToolHandler');
  }

  /**
   * Tool definitions with validation and execution logic
   */
  private static readonly TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
    startQuiz: {
      name: 'startQuiz',
      requiresSession: false,
      allowedStates: [],
      validator: () => true,
      executor: async (handler, args) => handler.executeStartQuiz(args),
    },

    nextQuestion: {
      name: 'nextQuestion',
      requiresSession: true,
      allowedStates: ['active'],
      validator: () => true,
      executor: async (handler, args, sessionId) => handler.executeNextQuestion(sessionId!),
    },

    markTTSEnd: {
      name: 'markTTSEnd',
      requiresSession: true,
      allowedStates: ['active'],
      rateLimit: { limit: 20, windowMs: 60000 },
      validator: (args) => {
        return typeof args.sessionQuestionId === 'string' &&
               (args.clientTimestamp === undefined || typeof args.clientTimestamp === 'number');
      },
      executor: async (handler, args) => handler.executeMarkTTSEnd(args),
    },

    markSpeechStart: {
      name: 'markSpeechStart',
      requiresSession: true,
      allowedStates: ['active'],
      rateLimit: { limit: 20, windowMs: 60000 },
      validator: (args) => {
        return typeof args.sessionQuestionId === 'string' &&
               typeof args.vadThreshold === 'number' &&
               (args.clientTimestamp === undefined || typeof args.clientTimestamp === 'number');
      },
      executor: async (handler, args) => handler.executeMarkSpeechStart(args),
    },

    submitAnswer: {
      name: 'submitAnswer',
      requiresSession: true,
      allowedStates: ['active'],
      rateLimit: { limit: 15, windowMs: 60000 },
      validator: (args) => {
        return typeof args.sessionQuestionId === 'string' &&
               typeof args.answer === 'string' &&
               args.answer.trim().length > 0 &&
               typeof args.confidence === 'number' &&
               args.confidence >= 0 && args.confidence <= 1 &&
               (args.clientTimestamp === undefined || typeof args.clientTimestamp === 'number');
      },
      executor: async (handler, args) => handler.executeSubmitAnswer(args),
    },

    finishQuiz: {
      name: 'finishQuiz',
      requiresSession: true,
      allowedStates: ['active'],
      validator: () => true,
      executor: async (handler, args, sessionId) => handler.executeFinishQuiz(sessionId!),
    },

    infoLookup: {
      name: 'infoLookup',
      requiresSession: false,
      allowedStates: [],
      rateLimit: { limit: 30, windowMs: 60000 },
      validator: (args) => {
        return typeof args.query === 'string' &&
               args.query.trim().length >= 3 &&
               args.query.trim().length <= 100;
      },
      executor: async (handler, args) => handler.executeInfoLookup(args),
    },
  };

  /**
   * Main tool execution method
   */
  async executeTool(toolName: string, args: any, sessionId?: string): Promise<any> {
    const toolDef = SecureToolHandler.TOOL_DEFINITIONS[toolName];

    if (!toolDef) {
      throw new ToolExecutionError(
        `Bilinmeyen tool: ${toolName}`,
        'UNKNOWN_TOOL',
        400
      );
    }

    // Validate tool arguments
    if (!toolDef.validator(args)) {
      throw new ToolExecutionError(
        'Geçersiz tool parametreleri',
        'INVALID_TOOL_ARGS',
        400
      );
    }

    // Check session requirement
    if (toolDef.requiresSession && !sessionId) {
      throw new ToolExecutionError(
        'Bu tool için session ID gerekli',
        'SESSION_REQUIRED',
        400
      );
    }

    // Validate session state
    if (sessionId) {
      const sessionState = await this.getSessionState(sessionId);

      if (!sessionState) {
        throw new ToolExecutionError(
          'Session bulunamadı',
          'SESSION_NOT_FOUND',
          404
        );
      }

      if (sessionState.participantId !== parseInt(this.user.id)) {
        throw new ToolExecutionError(
          'Bu session size ait değil',
          'SESSION_ACCESS_DENIED',
          403
        );
      }

      if (toolDef.allowedStates.length > 0 && 
          !toolDef.allowedStates.includes(sessionState.status)) {
        throw new ToolExecutionError(
          `Tool bu session durumunda kullanılamaz: ${sessionState.status}`,
          'INVALID_SESSION_STATE',
          400
        );
      }
    }

    // Execute tool
    try {
      const result = await toolDef.executor(this, args, sessionId);

      // Audit log
      await this.auditToolExecution(toolName, args, sessionId, result);

      return result;

    } catch (error) {
      this.logger.error('Tool execution failed', error as Error, {
        userId: this.user.id,
        toolName,
        sessionId,
        args,
      });

      throw error;
    }
  }

  /**
   * Start Quiz Tool Implementation
   */
  private async executeStartQuiz(args: any): Promise<any> {
    // Check for existing active session
    const existingSessionResult = await this.db
      .select()
      .from(quizSessions)
      .where(
        and(
          eq(quizSessions.participantId, parseInt(this.user.id)),
          eq(quizSessions.status, 'active')
        )
      )
      .limit(1);

    if (existingSessionResult.length > 0) {
      throw new ToolExecutionError(
        'Zaten aktif bir yarışma oturumunuz var',
        'ACTIVE_SESSION_EXISTS',
        409
      );
    }

    // Create new session
    const sessionId = dbHelpers.generateId();

    await this.db.insert(quizSessions).values({
      id: sessionId,
      participantId: parseInt(this.user.id),
      status: 'active',
      totalScore: 0,
      currentQuestionIndex: 0,
    });

    // Get first question
    const firstQuestion = await this.getNextQuestion(sessionId, 0);

    // Log privacy activity
    await this.privacyService.logDataProcessing(
      parseInt(this.user.id),
      'quiz_participation',
      ['performance_data'],
      'Yarışma oturumu başlatma'
    );

    return {
      sessionId,
      status: 'active',
      currentQuestion: firstQuestion,
      totalScore: 0,
      questionIndex: 0,
    };
  }

  /**
   * Next Question Tool Implementation
   */
  private async executeNextQuestion(sessionId: string): Promise<any> {
    const session = await this.getSessionState(sessionId);

    if (!session) {
      throw new ToolExecutionError('Session bulunamadı', 'SESSION_NOT_FOUND', 404);
    }

    const nextIndex = session.currentQuestionIndex + 1;
    const maxQuestions = await this.getMaxQuestions();

    if (nextIndex >= maxQuestions) {
      throw new ToolExecutionError(
        'Tüm sorular tamamlandı',
        'ALL_QUESTIONS_COMPLETED',
        400
      );
    }

    // Update session
    await this.db
      .update(quizSessions)
      .set({
        currentQuestionIndex: nextIndex,
        lastActivityAt: sql`(unixepoch())`,
      })
      .where(eq(quizSessions.id, sessionId));

    // Get next question
    const nextQuestion = await this.getNextQuestion(sessionId, nextIndex);

    return {
      sessionId,
      currentQuestion: nextQuestion,
      questionIndex: nextIndex,
      totalQuestions: maxQuestions,
    };
  }

  /**
   * Mark TTS End Tool Implementation
   */
  private async executeMarkTTSEnd(args: {
    sessionQuestionId: string;
    clientTimestamp?: number;
  }): Promise<any> {
    const eventId = await this.timingService.markTTSEndEvent(
      args.sessionQuestionId,
      args.clientTimestamp
    );

    const timerStartTime = await this.timingService.calculateTimerStart(args.sessionQuestionId);

    return {
      eventId,
      eventType: 'tts_end',
      timerStartTime,
      serverTimestamp: Date.now(),
    };
  }

  /**
   * Mark Speech Start Tool Implementation
   */
  private async executeMarkSpeechStart(args: {
    sessionQuestionId: string;
    vadThreshold: number;
    clientTimestamp?: number;
  }): Promise<any> {
    const eventId = await this.timingService.markSpeechStartEvent(
      args.sessionQuestionId,
      args.vadThreshold,
      args.clientTimestamp
    );

    return {
      eventId,
      eventType: 'speech_start',
      vadThreshold: args.vadThreshold,
      serverTimestamp: Date.now(),
    };
  }

  /**
   * Submit Answer Tool Implementation
   */
  private async executeSubmitAnswer(args: {
    sessionQuestionId: string;
    answer: string;
    confidence: number;
    clientTimestamp?: number;
  }): Promise<any> {
    // Mark ASR received event
    const eventId = await this.timingService.markASRReceivedEvent(
      args.sessionQuestionId,
      args.answer,
      args.confidence,
      args.clientTimestamp
    );

    // Get question info
    const questionInfo = await this.getQuestionInfo(args.sessionQuestionId);

    if (!questionInfo) {
      throw new ToolExecutionError(
        'Soru bilgisi bulunamadı',
        'QUESTION_NOT_FOUND',
        404
      );
    }

    // Validate answer
    const validationResult = this.scoringService.validateAnswer(
      args.answer,
      questionInfo.correctAnswer
    );

    // Calculate response time
    const responseTime = await this.timingService.calculateResponseTime(args.sessionQuestionId);

    if (responseTime === null) {
      throw new ToolExecutionError(
        'Yanıt süresi hesaplanamadı',
        'RESPONSE_TIME_CALCULATION_FAILED',
        500
      );
    }

    // Calculate score
    const scoreResult = await this.scoringService.calculateScore(
      args.sessionQuestionId,
      validationResult,
      responseTime
    );

    // Update session question
    await this.db
      .update(sessionQuestions)
      .set({
        answeredAt: sql`(unixepoch())`,
        userAnswer: args.answer,
        isCorrect: validationResult.isCorrect,
        pointsEarned: scoreResult.finalScore,
        responseTime: responseTime,
        isAnswered: true,
      })
      .where(eq(sessionQuestions.id, args.sessionQuestionId));

    // Update session total score
    await this.db
      .update(quizSessions)
      .set({
        totalScore: sql`${quizSessions.totalScore} + ${scoreResult.finalScore}`,
        lastActivityAt: sql`(unixepoch())`,
      })
      .where(eq(quizSessions.id, questionInfo.sessionId));

    // Privacy compliance
    await this.privacyService.handleAudioPrivacy(args.sessionQuestionId, args.answer);

    return {
      eventId,
      isCorrect: validationResult.isCorrect,
      matchType: validationResult.matchType,
      similarity: validationResult.similarity,
      earnedPoints: scoreResult.finalScore,
      responseTime,
      scoreBreakdown: {
        basePoints: scoreResult.basePoints,
        timeBonus: scoreResult.timeBonus,
        streakBonus: scoreResult.streakBonus,
        difficultyBonus: scoreResult.difficultyBonus,
      },
      correctAnswer: questionInfo.correctAnswer,
    };
  }

  /**
   * Finish Quiz Tool Implementation
   */
  private async executeFinishQuiz(sessionId: string): Promise<any> {
    // Update session status
    await this.db
      .update(quizSessions)
      .set({
        status: 'completed',
        completedAt: sql`(unixepoch())`,
        lastActivityAt: sql`(unixepoch())`,
      })
      .where(eq(quizSessions.id, sessionId));

    // Get final results
    const finalResults = await this.getFinalResults(sessionId);

    // Get leaderboard position
    const leaderboard = await this.scoringService.getLeaderboard(100);
    const userRank = leaderboard.findIndex(entry => 
      entry.participantId === parseInt(this.user.id)
    ) + 1;

    return {
      sessionId,
      status: 'completed',
      finalResults,
      leaderboardRank: userRank || null,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Info Lookup Tool Implementation
   */
  private async executeInfoLookup(args: { query: string }): Promise<any> {
    // Simple knowledge search (placeholder - would use FTS in production)
    const searchQuery = args.query.toLowerCase();
    
    // Privacy compliance
    await this.privacyService.logDataProcessing(
      parseInt(this.user.id),
      'data_export',
      ['usage_data'],
      'Bilgi bankası sorgusu'
    );

    // Mock search results for now
    const mockResults = [
      {
        id: 1,
        title: 'Sıfır Atık Hakkında',
        content: 'Sıfır atık yaşam tarzı hakkında bilgi...',
        relevanceScore: 0.9,
      }
    ];

    return {
      query: args.query,
      results: mockResults,
      resultCount: mockResults.length,
    };
  }

  /**
   * Idempotency methods
   */
  async checkIdempotency(key: string): Promise<any | null> {
    const record = this.idempotencyCache.get(key);

    if (record && record.expiresAt > new Date()) {
      return record.result;
    }

    this.cleanupExpiredIdempotencyRecords();
    return null;
  }

  async storeIdempotencyResult(key: string, result: any): Promise<void> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    this.idempotencyCache.set(key, {
      key,
      result,
      createdAt: new Date(),
      expiresAt,
    });
  }

  /**
   * Session validation
   */
  async validateSession(sessionId: string): Promise<boolean> {
    const session = await this.getSessionState(sessionId);

    return session !== null && 
           session.participantId === parseInt(this.user.id) &&
           session.status === 'active';
  }

  /**
   * Helper methods
   */
  private async getSessionState(sessionId: string) {
    const sessionResult = await this.db
      .select()
      .from(quizSessions)
      .where(eq(quizSessions.id, sessionId))
      .limit(1);

    return sessionResult[0] || null;
  }

  private async getQuestionInfo(sessionQuestionId: string) {
    const result = await this.db
      .select({
        sessionId: sessionQuestions.sessionId,
        correctAnswer: questions.correctAnswer,
        basePoints: questions.basePoints,
        timeLimit: questions.timeLimit,
        difficulty: questions.difficulty,
      })
      .from(sessionQuestions)
      .innerJoin(questions, eq(sessionQuestions.questionId, questions.id))
      .where(eq(sessionQuestions.id, sessionQuestionId))
      .limit(1);

    return result[0] || null;
  }

  private async getNextQuestion(sessionId: string, questionIndex: number) {
    // Get question by order
    const questionResult = await this.db
      .select()
      .from(questions)
      .where(
        and(
          eq(questions.orderNo, questionIndex + 1),
          eq(questions.isActive, true)
        )
      )
      .limit(1);

    const question = questionResult[0];

    if (!question) {
      throw new ToolExecutionError(
        'Soru bulunamadı',
        'QUESTION_NOT_FOUND',
        404
      );
    }

    // Create session question
    const sessionQuestionId = dbHelpers.generateId();

    await this.db.insert(sessionQuestions).values({
      id: sessionQuestionId,
      sessionId,
      questionId: question.id,
      orderInSession: questionIndex + 1,
    });

    return {
      sessionQuestionId,
      questionId: question.id,
      text: question.text,
      options: question.options ? JSON.parse(question.options) : null,
      difficulty: question.difficulty,
      timeLimit: question.timeLimit,
      basePoints: question.basePoints,
    };
  }

  private async getMaxQuestions(): Promise<number> {
    const maxQuestionsResult = await this.db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, 'MAX_QUESTIONS_PER_SESSION'))
      .limit(1);

    return parseInt(maxQuestionsResult[0]?.value || '10');
  }

  private async getFinalResults(sessionId: string) {
    const results = await this.db
      .select({
        totalScore: quizSessions.totalScore,
        questionsAnswered: sql<number>`COUNT(${sessionQuestions.id})`,
        correctAnswers: sql<number>`SUM(CASE WHEN ${sessionQuestions.isCorrect} = 1 THEN 1 ELSE 0 END)`,
        averageResponseTime: sql<number>`AVG(${sessionQuestions.responseTime})`,
      })
      .from(quizSessions)
      .leftJoin(sessionQuestions, eq(quizSessions.id, sessionQuestions.sessionId))
      .where(eq(quizSessions.id, sessionId))
      .groupBy(quizSessions.id);

    return results[0] || {
      totalScore: 0,
      questionsAnswered: 0,
      correctAnswers: 0,
      averageResponseTime: 0,
    };
  }

  private async auditToolExecution(
    toolName: string,
    args: any,
    sessionId: string | undefined,
    result: any
  ): Promise<void> {
    await this.db.insert(auditLogs).values({
      tableName: 'tool_executions',
      recordId: sessionId || 'no_session',
      action: 'INSERT',
      newValues: JSON.stringify({
        toolName,
        args,
        result: typeof result === 'object' ? JSON.stringify(result) : result,
      }),
      participantId: parseInt(this.user.id),
      privacyImpact: 'tool_execution',
    });
  }

  private cleanupExpiredIdempotencyRecords(): void {
    const now = new Date();

    for (const [key, record] of this.idempotencyCache.entries()) {
      if (record.expiresAt <= now) {
        this.idempotencyCache.delete(key);
      }
    }
  }
}

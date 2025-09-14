/**
 * Secure Tool Handler
 * Validates and executes tool calls with security and state consistency
 */

import { eq, and, sql } from 'drizzle-orm';

import { 
  quizSessions,
  sessionQuestions,
  questions,
  systemSettings,
  auditLogs
} from '../db/schema';
import { TimingService } from './TimingService';
import { ScoringService } from './ScoringService';
import { PrivacyService } from './PrivacyService';
import { KnowledgeService } from './KnowledgeService';
import { Logger } from '../utils/logger';
import { AppError, ErrorCode } from '../types/errors';

import type { DatabaseInstance } from '../db/connection';
import type { UserContext } from '../middleware/RoleMiddleware';

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
export class ToolExecutionError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
    statusCode: number = 400
  ) {
    super(code, message, statusCode);
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
  private knowledgeService: KnowledgeService;
  private idempotencyCache = new Map<string, IdempotencyRecord>();
  private lastTTSEndEvents = new Map<string, number>();
  private logger: Logger;

  constructor(db: DatabaseInstance, user: UserContext) {
    this.db = db;
    this.user = user;
    this.timingService = new TimingService(db);
    this.scoringService = new ScoringService(db);
    this.privacyService = new PrivacyService(db);
    this.knowledgeService = new KnowledgeService(db);
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
      executor: async (handler) => handler.executeStartQuiz(),
    },

    nextQuestion: {
      name: 'nextQuestion',
      requiresSession: true,
      allowedStates: ['active'],
      validator: () => true,
      executor: async (handler, _, sessionId) => handler.executeNextQuestion(sessionId!),
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
      executor: async (handler, _, sessionId) => handler.executeFinishQuiz(sessionId!),
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
        ErrorCode.NOT_FOUND,
        400
      );
    }

    // Validate tool arguments
    if (!toolDef.validator(args)) {
      throw new ToolExecutionError(
        'Geçersiz tool parametreleri',
        ErrorCode.BAD_REQUEST,
        400
      );
    }

    // Check session requirement
    if (toolDef.requiresSession && !sessionId) {
      throw new ToolExecutionError(
        'Bu tool için session ID gerekli',
        ErrorCode.BAD_REQUEST,
        400
      );
    }

    // Validate session state
    if (sessionId) {
      const sessionState = await this.getSessionState(sessionId);

      if (!sessionState) {
        throw new ToolExecutionError(
          'Session bulunamadı',
          ErrorCode.SESSION_NOT_FOUND,
          404
        );
      }

      if (sessionState.participantId !== parseInt(this.user.id)) {
        throw new ToolExecutionError(
          'Bu session size ait değil',
          ErrorCode.FORBIDDEN,
          403
        );
      }

      if (toolDef.allowedStates.length > 0 && 
          !toolDef.allowedStates.includes(sessionState.status)) {
        throw new ToolExecutionError(
          `Tool bu session durumunda kullanılamaz: ${sessionState.status}`,
          ErrorCode.SESSION_INVALID,
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
  private async executeStartQuiz(): Promise<any> {
    // Check for existing active session
    console.log('Checking for active session:', {
      userId: this.user.id,
      parsedUserId: parseInt(this.user.id)
    });
    
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
      console.log('Existing active session found, returning it:', {
        userId: this.user.id,
        parsedUserId: parseInt(this.user.id),
        existingSession: existingSessionResult[0]
      });
      
      // Return existing session instead of throwing error
      const existingSession = existingSessionResult[0];

      // Load current question for existing session
      const currentQuestion = await this.getNextQuestion(existingSession.id, existingSession.currentQuestionIndex);

      return {
        sessionId: existingSession?.id || '',
        currentQuestion: currentQuestion,
        totalScore: existingSession?.totalScore || 0,
        questionIndex: existingSession?.currentQuestionIndex || 0,
        questionsAnswered: existingSession?.questionsAnswered || 0
      };
    }

    // Create new session
    const sessionId = crypto.randomUUID();

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
    await this.privacyService.logDataProcessing({
      participantId: parseInt(this.user.id),
      activityType: 'quiz_participation',
      dataCategories: ['performance_data'],
      processingPurpose: 'Yarışma oturumu başlatma',
      legalBasis: 'consent',
      retentionPeriod: 365
    });

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
      throw new ToolExecutionError('Session bulunamadı', ErrorCode.SESSION_NOT_FOUND, 404);
    }

    const nextIndex = session.currentQuestionIndex + 1;
    const maxQuestions = await this.getMaxQuestions();

    if (nextIndex >= maxQuestions) {
      throw new ToolExecutionError(
        'Tüm sorular tamamlandı',
        ErrorCode.QUIZ_COMPLETED,
        400
      );
    }

    // Update session
    await this.db
      .update(quizSessions)
      .set({
        currentQuestionIndex: nextIndex,
        lastActivityAt: new Date(),
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
    const ttsEndedAt = args.clientTimestamp || Date.now();
    
    // Deduplication check
    const lastEventTime = this.lastTTSEndEvents.get(args.sessionQuestionId);
    if (lastEventTime && (ttsEndedAt - lastEventTime) < 1000) {
      console.log('🔄 TTS end event deduplicated:', args.sessionQuestionId);
      return { 
        success: true, 
        data: { 
          deduplicated: true,
          sessionQuestionId: args.sessionQuestionId,
          timerStarted: false
        } 
      };
    }
    
    // Store this event time
    this.lastTTSEndEvents.set(args.sessionQuestionId, ttsEndedAt);
    
    // Cleanup old events periodically
    this.cleanupOldTTSEvents();
    
    // Verify session question exists
    const sessionQuestion = await this.db
      .select()
      .from(sessionQuestions)
      .where(eq(sessionQuestions.id, args.sessionQuestionId))
      .limit(1);

    if (sessionQuestion.length === 0) {
      throw new ToolExecutionError(
        'Session question not found',
        ErrorCode.QUESTION_NOT_FOUND,
        404
      );
    }

    // Record timing event
    const eventId = await this.timingService.markTTSEndEvent(
      args.sessionQuestionId,
      ttsEndedAt
    );

    const timerStartTime = await this.timingService.calculateTimerStart(args.sessionQuestionId);

    console.log('✅ TTS end marked successfully:', {
      sessionQuestionId: args.sessionQuestionId,
      eventId,
      timerStartTime,
      ttsEndedAt
    });

    return {
      success: true,
      data: {
        eventId,
        eventType: 'tts_end',
        timerStartTime,
        timerStarted: true,
        sessionQuestionId: args.sessionQuestionId,
        serverTimestamp: Date.now(),
        ttsEndedAt
      }
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
    console.log('🏆 executeSubmitAnswer called with:', {
      sessionQuestionId: args.sessionQuestionId,
      answer: args.answer,
      confidence: args.confidence,
      clientTimestamp: args.clientTimestamp
    });

    // Mark ASR received event
    const eventId = await this.timingService.markASRReceivedEvent(
      args.sessionQuestionId,
      args.answer,
      args.confidence,
      args.clientTimestamp
    );
    console.log('🏆 ASR event marked:', eventId);

    // Get question info
    const questionInfo = await this.getQuestionInfo(args.sessionQuestionId);

    if (!questionInfo) {
      throw new ToolExecutionError(
        'Soru bilgisi bulunamadı',
        ErrorCode.QUESTION_NOT_FOUND,
        404
      );
    }

    console.log('🏆 Question info retrieved:', {
      correctAnswer: questionInfo.correctAnswer,
      difficulty: questionInfo.difficulty,
      timeLimit: questionInfo.timeLimit,
      basePoints: questionInfo.points
    });

    // Validate answer
    const validationResult = this.scoringService.validateAnswer(
      args.answer,
      questionInfo.correctAnswer
    );

    console.log('🏆 Answer validation result:', {
      isCorrect: validationResult.isCorrect,
      matchType: validationResult.matchType,
      similarity: validationResult.similarity
    });

    // Calculate response time
    const responseTime = await this.timingService.calculateResponseTime(args.sessionQuestionId);

    if (responseTime === null) {
      throw new ToolExecutionError(
        'Yanıt süresi hesaplanamadı',
        ErrorCode.INTERNAL_SERVER_ERROR,
        500
      );
    }

    console.log('🏆 Response time calculated:', responseTime);

    // Calculate score
    const question = await this.getQuestionInfo(args.sessionQuestionId);
    const scoreResult = await this.scoringService.calculateScore(
      args.sessionQuestionId,
      validationResult,
      responseTime,
      question ? question.timeLimit * 1000 : 30000,
      question ? parseInt(question.difficulty) : 1
    );

    console.log('🏆 Score calculation result:', {
      finalScore: scoreResult.finalScore,
      basePoints: scoreResult.basePoints,
      timeBonus: scoreResult.timeBonus
    });

    // Update session question
    await this.db
      .update(sessionQuestions)
      .set({
        answeredAt: new Date(),
        userAnswer: args.answer,
        isCorrect: validationResult.isCorrect,
        pointsEarned: scoreResult.finalScore,
        responseTime: responseTime,
        isAnswered: true,
      })
      .where(eq(sessionQuestions.id, args.sessionQuestionId));

    console.log('🏆 Session question updated with points:', scoreResult.finalScore);

    // Update session total score
    await this.db
      .update(quizSessions)
      .set({
        totalScore: sql`${quizSessions.totalScore} + ${scoreResult.finalScore}`,
        lastActivityAt: new Date(),
      })
      .where(eq(quizSessions.id, (questionInfo as any).sessionId));

    console.log('🏆 Session total score updated by adding:', scoreResult.finalScore);

    // Privacy compliance
    await this.privacyService.handleAudioPrivacy(args.sessionQuestionId);

    const result = {
      eventId,
      isCorrect: validationResult.isCorrect,
      matchType: validationResult.matchType,
      similarity: validationResult.similarity,
      earnedPoints: scoreResult.finalScore,
      responseTime,
      scoreBreakdown: {
        basePoints: scoreResult.basePoints,
        timeBonus: scoreResult.timeBonus,
        streakBonus: (scoreResult as any).scoreBreakdown?.streakBonus || 0,
        difficultyBonus: (scoreResult as any).scoreBreakdown?.difficultyBonus || 0,
      },
      correctAnswer: questionInfo.correctAnswer,
    };

    console.log('🏆 executeSubmitAnswer returning result:', result);
    return result;
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
        completedAt: new Date(),
        lastActivityAt: new Date(),
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
    try {
      // Use KnowledgeService for intelligent search
      const searchResult = await this.knowledgeService.handleInfoQuery(args.query);
      
      // Privacy compliance - log the search
      await this.privacyService.logDataProcessing({
        participantId: parseInt(this.user.id),
        activityType: 'data_export',
        dataCategories: ['usage_data'],
        processingPurpose: 'Bilgi bankası sorgusu',
        legalBasis: 'legitimate_interest',
        retentionPeriod: 30
      });

      return {
        query: args.query,
        results: searchResult.results,
        resultCount: searchResult.results.length,
        responseText: searchResult.responseText,
        intent: searchResult.intent,
        success: true
      };

    } catch (error) {
      Logger.error('Info lookup execution failed', error as Error, {
        query: args.query,
        userId: this.user.id
      });

      return {
        query: args.query,
        results: [],
        resultCount: 0,
        responseText: 'Bilgi arama sırasında hata oluştu. Lütfen tekrar deneyin.',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
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

  // Unused method removed
  /*private async getQuestionInfoOld(sessionQuestionId: string) {
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
  }*/

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
        ErrorCode.QUESTION_NOT_FOUND,
        404
      );
    }

    // Check if session question already exists
    const existingSessionQuestion = await this.db
      .select()
      .from(sessionQuestions)
      .where(
        and(
          eq(sessionQuestions.sessionId, sessionId),
          eq(sessionQuestions.orderInSession, questionIndex + 1)
        )
      )
      .limit(1);

    let sessionQuestionId: string;

    if (existingSessionQuestion.length > 0) {
      // Use existing session question
      sessionQuestionId = existingSessionQuestion[0].id;
    } else {
      // Create new session question
      sessionQuestionId = crypto.randomUUID();
      await this.db.insert(sessionQuestions).values({
        id: sessionQuestionId,
        sessionId,
        questionId: question.id,
        orderInSession: questionIndex + 1,
      });
    }

    // Safe JSON parsing for options
    let options = null;
    try {
      if (question.options) {
        options = typeof question.options === 'string' ? JSON.parse(question.options) : question.options;
      }
    } catch (error) {
      console.error('Error parsing question options:', error);
      options = null;
    }

    return {
      sessionQuestionId,
      questionId: question.id,
      text: question.text,
      options: options,
      difficulty: question.difficulty,
      timeLimit: question.timeLimit,
      basePoints: question.basePoints,
    };
  }

  private async getMaxQuestions(): Promise<number> {
    const maxQuestionsResult = await this.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'MAX_QUESTIONS_PER_SESSION'))
      .limit(1);

    return parseInt(maxQuestionsResult[0]?.value || '10');
  }

  private async getFinalResults(sessionId: string) {
    const results = await this.db
      .select()
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

  /**
   * Cleanup old TTS end events to prevent memory leaks
   */
  private cleanupOldTTSEvents(): void {
    const now = Date.now();
    for (const [key, time] of this.lastTTSEndEvents.entries()) {
      if (now - time > 300000) { // 5 minutes
        this.lastTTSEndEvents.delete(key);
      }
    }
    
    // Log cleanup if events were removed
    const remainingEvents = this.lastTTSEndEvents.size;
    if (remainingEvents > 0) {
      console.log(`🧹 TTS events cleanup: ${remainingEvents} active events remaining`);
    }
  }

  /**
   * Get question info from session question ID
   */
  private async getQuestionInfo(sessionQuestionId: string): Promise<{
    id: number;
    title: string;
    content: string;
    correctAnswer: string;
    category: string;
    difficulty: string;
    timeLimit: number;
    points: number;
  }> {
    const result = await this.db
      .select()
      .from(sessionQuestions)
      .innerJoin(questions, eq(sessionQuestions.questionId, questions.id))
      .where(eq(sessionQuestions.id, sessionQuestionId));

    if (!result || result.length === 0) {
      throw new ToolExecutionError(
        'Question not found',
        ErrorCode.QUESTION_NOT_FOUND,
        404
      );
    }

    const questionData = result[0];
    if (!questionData) {
      throw new ToolExecutionError(
        'Question not found',
        ErrorCode.QUESTION_NOT_FOUND,
        404
      );
    }
    
    return {
      id: parseInt((questionData as any).questions.id),
      title: (questionData as any).questions.text || 'Question',
      content: (questionData as any).questions.text,
      correctAnswer: (questionData as any).questions.correctAnswer,
      category: (questionData as any).questions.category,
      difficulty: (questionData as any).questions.difficulty.toString(),
      timeLimit: (questionData as any).questions.timeLimit,
      points: (questionData as any).questions.basePoints
    };
  }
}

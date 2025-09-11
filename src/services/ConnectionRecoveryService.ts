/**
 * Connection Recovery Service
 * Handles connection failures and state recovery for quiz sessions
 */

import { eq, and, desc } from 'drizzle-orm';
import { quizSessions, sessionQuestions, questionTimings } from '@/db/schema';
import { Logger } from '@/utils/logger';
import type { DatabaseInstance } from '@/db/connection';

interface SessionState {
  sessionId: string;
  participantId: number;
  currentQuestionIndex: number;
  totalScore: number;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  lastQuestionId?: string;
  lastActivityAt: Date;
  timingEvents: Array<{
    eventType: string;
    timestamp: number;
    metadata?: any;
  }>;
}

interface RecoveryResult {
  success: boolean;
  sessionState?: SessionState;
  canResume: boolean;
  error?: string;
  suggestedAction: 'resume' | 'restart' | 'continue_from_last' | 'abandon';
}

interface ConnectionMetrics {
  disconnectionCount: number;
  totalDowntime: number; // milliseconds
  lastDisconnectionAt?: Date;
  recoveryAttempts: number;
  successfulRecoveries: number;
}

export class ConnectionRecoveryService {
  private db: DatabaseInstance;
  private static readonly MAX_RECOVERY_ATTEMPTS = 3;
  private static readonly SESSION_TIMEOUT_MS = 1800000; // 30 minutes

  private connectionMetrics = new Map<string, ConnectionMetrics>();

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  /**
   * Handle disconnection event
   */
  async handleDisconnection(
    sessionId: string,
    participantId: number,
    disconnectionReason: 'network' | 'client' | 'server' | 'timeout' | 'user_action'
  ): Promise<void> {
    try {
      // Update session status to paused
      await this.db
        .update(quizSessions)
        .set({
          status: 'paused',
          lastActivityAt: new Date()
        })
        .where(
          and(
            eq(quizSessions.id, sessionId),
            eq(quizSessions.participantId, participantId)
          )
        );

      // Update connection metrics
      this.updateConnectionMetrics(sessionId, 'disconnection');

      // Log disconnection
      Logger.warn('Session disconnected', {
        sessionId,
        participantId,
        reason: disconnectionReason,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      Logger.error('Failed to handle disconnection', error as Error, {
        sessionId,
        participantId,
        disconnectionReason
      });
      throw new Error('Disconnection handling failed');
    }
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  async attemptReconnection(
    sessionId: string,
    participantId: number,
    attemptNumber: number = 1
  ): Promise<RecoveryResult> {
    try {
      // Check if max attempts exceeded
      if (attemptNumber > ConnectionRecoveryService.MAX_RECOVERY_ATTEMPTS) {
        Logger.warn('Max recovery attempts exceeded', {
          sessionId,
          participantId,
          attemptNumber
        });

        return {
          success: false,
          canResume: false,
          error: 'Maximum recovery attempts exceeded',
          suggestedAction: 'restart'
        };
      }

      // Update connection metrics
      this.updateConnectionMetrics(sessionId, 'recovery_attempt');

      // Validate session integrity
      const integrityResult = await this.validateSessionIntegrity(sessionId, participantId);
      
      if (!integrityResult.isValid) {
        return {
          success: false,
          canResume: false,
          error: integrityResult.error,
          suggestedAction: integrityResult.canRecover ? 'continue_from_last' : 'restart'
        };
      }

      // Resume from last state
      const sessionState = await this.getSessionState(sessionId, participantId);
      
      if (!sessionState) {
        return {
          success: false,
          canResume: false,
          error: 'Session state not found',
          suggestedAction: 'restart'
        };
      }

      // Check session timeout
      const now = new Date();
      const timeSinceLastActivity = now.getTime() - sessionState.lastActivityAt.getTime();
      
      if (timeSinceLastActivity > ConnectionRecoveryService.SESSION_TIMEOUT_MS) {
        // Session timed out
        await this.abandonSession(sessionId);
        
        return {
          success: false,
          canResume: false,
          error: 'Session timed out',
          suggestedAction: 'restart'
        };
      }

      // Successful recovery
      await this.resumeSession(sessionId);
      this.updateConnectionMetrics(sessionId, 'successful_recovery');

      Logger.info('Session recovery successful', {
        sessionId,
        participantId,
        attemptNumber,
        currentQuestionIndex: sessionState.currentQuestionIndex
      });

      return {
        success: true,
        sessionState,
        canResume: true,
        suggestedAction: 'resume'
      };

    } catch (error) {
      Logger.error('Connection recovery failed', error as Error, {
        sessionId,
        participantId,
        attemptNumber
      });

      // Exponential backoff for next attempt
      
      return {
        success: false,
        canResume: attemptNumber < ConnectionRecoveryService.MAX_RECOVERY_ATTEMPTS,
        error: `Recovery attempt ${attemptNumber} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        suggestedAction: attemptNumber < ConnectionRecoveryService.MAX_RECOVERY_ATTEMPTS ? 'resume' : 'restart'
      };
    }
  }

  /**
   * Resume session from last state
   */
  async resumeFromLastState(sessionId: string, participantId: number): Promise<SessionState | null> {
    try {
      const sessionState = await this.getSessionState(sessionId, participantId);
      
      if (!sessionState) {
        throw new Error('Session state not found');
      }

      // Update session to active
      await this.resumeSession(sessionId);

      // Sync timing events if needed
      await this.syncTimingEvents(sessionId);

      Logger.info('Session resumed from last state', {
        sessionId,
        participantId,
        currentQuestionIndex: sessionState.currentQuestionIndex,
        totalScore: sessionState.totalScore
      });

      return sessionState;

    } catch (error) {
      Logger.error('Failed to resume from last state', error as Error, {
        sessionId,
        participantId
      });
      return null;
    }
  }

  /**
   * Validate session integrity
   */
  async validateSessionIntegrity(sessionId: string, participantId: number): Promise<{
    isValid: boolean;
    canRecover: boolean;
    error?: string;
    issues: string[];
  }> {
    try {
      const issues: string[] = [];
      
      // Check if session exists
      const session = await this.db
        .select()
        .from(quizSessions)
        .where(
          and(
            eq(quizSessions.id, sessionId),
            eq(quizSessions.participantId, participantId)
          )
        )
        .limit(1);

      if (session.length === 0) {
        return {
          isValid: false,
          canRecover: false,
          error: 'Session not found',
          issues: ['session_not_found']
        };
      }

      const sessionData = session[0];

      // Check session status
      if (sessionData) {
        if (sessionData.status === 'completed') {
          return {
            isValid: false,
            canRecover: false,
            error: 'Session already completed',
            issues: ['session_completed']
          };
        }

        if (sessionData.status === 'abandoned') {
          return {
            isValid: false,
            canRecover: false,
            error: 'Session was abandoned',
            issues: ['session_abandoned']
          };
        }
      }

      // Check for timing inconsistencies
      const timingInconsistencies = await this.checkTimingConsistency(sessionId);
      if (timingInconsistencies.length > 0) {
        issues.push(...timingInconsistencies);
      }

      // Check for missing session questions
      const questionIntegrity = await this.checkQuestionIntegrity(sessionId);
      if (!questionIntegrity.isValid) {
        issues.push('missing_session_questions');
      }

      const isValid = issues.length === 0;
      const canRecover = issues.length <= 2; // Allow recovery with minor issues

      return {
        isValid,
        canRecover,
        issues,
        error: isValid ? undefined : `Integrity issues: ${issues.join(', ')}`
      };

    } catch (error) {
      Logger.error('Session integrity validation failed', error as Error, {
        sessionId,
        participantId
      });

      return {
        isValid: false,
        canRecover: false,
        error: 'Integrity validation failed',
        issues: ['validation_error']
      };
    }
  }

  /**
   * Sync state with client
   */
  async syncStateWithClient(
    sessionId: string,
    clientState: Partial<SessionState>
  ): Promise<SessionState> {
    try {
      // Get server state
      const serverState = await this.getSessionState(sessionId, clientState.participantId!);
      
      if (!serverState) {
        throw new Error('Server state not found');
      }

      // Resolve conflicts (server state wins)
      const syncedState: SessionState = {
        ...serverState,
        // Client can only update last activity
        lastActivityAt: clientState.lastActivityAt || serverState.lastActivityAt
      };

      // Update last activity time
      await this.db
        .update(quizSessions)
        .set({
          lastActivityAt: syncedState.lastActivityAt
        })
        .where(eq(quizSessions.id, sessionId));

      Logger.info('State synced with client', {
        sessionId,
        participantId: syncedState.participantId
      });

      return syncedState;

    } catch (error) {
      Logger.error('State sync failed', error as Error, {
        sessionId
      });
      throw new Error('State synchronization failed');
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get session state from database
   */
  private async getSessionState(sessionId: string, participantId: number): Promise<SessionState | null> {
    try {
      const session = await this.db
        .select()
        .from(quizSessions)
        .where(
          and(
            eq(quizSessions.id, sessionId),
            eq(quizSessions.participantId, participantId)
          )
        )
        .limit(1);

      if (session.length === 0) {
        return null;
      }

      const sessionData = session[0];

      // Get timing events
      const timingEvents = await this.db
        .select()
        .from(questionTimings)
        .innerJoin(sessionQuestions, eq(questionTimings.sessionQuestionId, sessionQuestions.id))
        .where(eq(sessionQuestions.sessionId, sessionId))
        .orderBy(desc(questionTimings.serverTimestamp));

      if (sessionData) {
        return {
          sessionId: sessionData.id,
          participantId: sessionData.participantId,
          currentQuestionIndex: sessionData.currentQuestionIndex,
          totalScore: sessionData.totalScore,
          status: sessionData.status as SessionState['status'],
          lastActivityAt: sessionData.lastActivityAt,
          timingEvents: timingEvents.map(te => ({
            eventType: te.question_timings.eventType,
            timestamp: te.question_timings.serverTimestamp,
            metadata: te.question_timings.metadata ? JSON.parse(te.question_timings.metadata) : undefined
          }))
        };
      }
      
      return null;

    } catch (error) {
      Logger.error('Failed to get session state', error as Error);
      return null;
    }
  }

  /**
   * Resume session
   */
  private async resumeSession(sessionId: string): Promise<void> {
    await this.db
      .update(quizSessions)
      .set({
        status: 'active',
        lastActivityAt: new Date()
      })
      .where(eq(quizSessions.id, sessionId));
  }

  /**
   * Abandon session
   */
  private async abandonSession(sessionId: string): Promise<void> {
    await this.db
      .update(quizSessions)
      .set({
        status: 'abandoned',
        lastActivityAt: new Date()
      })
      .where(eq(quizSessions.id, sessionId));
  }

  /**
   * Check timing consistency
   */
  private async checkTimingConsistency(sessionId: string): Promise<string[]> {
    try {
      const issues: string[] = [];
      
      // Get all timing events for session
      const events = await this.db
        .select()
        .from(questionTimings)
        .innerJoin(sessionQuestions, eq(questionTimings.sessionQuestionId, sessionQuestions.id))
        .where(eq(sessionQuestions.sessionId, sessionId))
        .orderBy(questionTimings.serverTimestamp);

      // Check for timing anomalies
      for (let i = 1; i < events.length; i++) {
        const prevEvent = events[i - 1];
        const currentEvent = events[i];
        
        if (currentEvent && prevEvent) {
          const timeDiff = currentEvent.question_timings.serverTimestamp - prevEvent.question_timings.serverTimestamp;
        
        // Check for negative time differences
        if (timeDiff < 0) {
          issues.push('negative_time_difference');
        }
        
          // Check for suspiciously large gaps
          if (timeDiff > 300000) { // 5 minutes
            issues.push('large_time_gap');
          }
        }
      }

      return issues;

    } catch (error) {
      Logger.error('Timing consistency check failed', error as Error);
      return ['timing_check_failed'];
    }
  }

  /**
   * Check question integrity
   */
  private async checkQuestionIntegrity(sessionId: string): Promise<{ isValid: boolean; missingQuestions: number }> {
    try {
      const sessionQuestionCount = await this.db
        .select()
        .from(sessionQuestions)
        .where(eq(sessionQuestions.sessionId, sessionId));

      const count = sessionQuestionCount.length;
      
      // Expect at least 1 question for active sessions
      return {
        isValid: count > 0,
        missingQuestions: count === 0 ? 1 : 0
      };

    } catch (error) {
      Logger.error('Question integrity check failed', error as Error);
      return { isValid: false, missingQuestions: 0 };
    }
  }

  /**
   * Sync timing events
   */
  private async syncTimingEvents(sessionId: string): Promise<void> {
    try {
      // This would sync any pending timing events
      // For now, just log the sync attempt
      Logger.info('Timing events synced', { sessionId });

    } catch (error) {
      Logger.error('Failed to sync timing events', error as Error);
    }
  }

  /**
   * Update connection metrics
   */
  private updateConnectionMetrics(sessionId: string, eventType: 'disconnection' | 'recovery_attempt' | 'successful_recovery'): void {
    let metrics = this.connectionMetrics.get(sessionId);
    
    if (!metrics) {
      metrics = {
        disconnectionCount: 0,
        totalDowntime: 0,
        recoveryAttempts: 0,
        successfulRecoveries: 0
      };
    }

    switch (eventType) {
      case 'disconnection':
        metrics.disconnectionCount++;
        metrics.lastDisconnectionAt = new Date();
        break;
      case 'recovery_attempt':
        metrics.recoveryAttempts++;
        break;
      case 'successful_recovery':
        metrics.successfulRecoveries++;
        if (metrics.lastDisconnectionAt) {
          metrics.totalDowntime += Date.now() - metrics.lastDisconnectionAt.getTime();
        }
        break;
    }

    this.connectionMetrics.set(sessionId, metrics);
  }

  /**
   * Get connection metrics
   */
  getConnectionMetrics(sessionId: string): ConnectionMetrics | null {
    return this.connectionMetrics.get(sessionId) || null;
  }

  /**
   * Cleanup old metrics
   */
  cleanupOldMetrics(): number {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cleanedCount = 0;

    for (const [sessionId, metrics] of this.connectionMetrics.entries()) {
      const lastActivity = metrics.lastDisconnectionAt?.getTime() || 0;
      
      if (now - lastActivity > maxAge) {
        this.connectionMetrics.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      Logger.info('Old connection metrics cleaned up', { cleanedCount });
    }

    return cleanedCount;
  }

  /**
   * Analyze recovery options for a session
   */
  async analyzeRecoveryOptions(sessionId: string, participantId: number, _attemptNumber: number): Promise<{
    canResume: boolean;
    suggestedAction: string;
    reason?: string;
  }> {
    try {
      const sessionData = await this.getSessionData(sessionId, participantId);
      
      if (!sessionData) {
        return {
          canResume: false,
          suggestedAction: 'start_new_session',
          reason: 'Session not found'
        };
      }

      if (sessionData.status === 'completed') {
        return {
          canResume: false,
          suggestedAction: 'view_results',
          reason: 'Session already completed'
        };
      }

      if (sessionData.status === 'abandoned') {
        return {
          canResume: true,
          suggestedAction: 'resume_session',
          reason: 'Session can be resumed'
        };
      }

      return {
        canResume: true,
        suggestedAction: 'continue_session'
      };
    } catch (error) {
      Logger.error('Failed to analyze recovery options', error as Error);
      return {
        canResume: false,
        suggestedAction: 'start_new_session',
        reason: 'Analysis failed'
      };
    }
  }

  /**
   * Get session data
   */
  private async getSessionData(sessionId: string, participantId: number): Promise<any> {
    const result = await this.db
      .select()
      .from(quizSessions)
      .where(
        and(
          eq(quizSessions.id, sessionId),
          eq(quizSessions.participantId, participantId)
        )
      );

    return result[0];
  }
}


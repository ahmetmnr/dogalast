/**
 * Server-Authoritative Timing Service
 * Manages all timing events to ensure fair and cheat-proof scoring
 */

import { and, eq, inArray } from 'drizzle-orm';

import { 
  questionTimings, 
  auditLogs, 
  sessionQuestions, 
  questions 
} from '@/db/schema';
import { Logger } from '@/utils/logger';

import type { DatabaseInstance } from '@/db/connection';

/**
 * Timing event interface
 */
interface TimingEvent {
  sessionQuestionId: string;
  eventType: 'tts_start' | 'tts_end' | 'speech_start' | 'answer_received';
  clientSignalTimestamp?: number;
  metadata?: {
    confidence?: number;
    audioDuration?: number;
    transcript?: string;
    interruptionDetected?: boolean;
    [key: string]: any;
  };
}

/**
 * Timing analysis interface
 */
export interface TimingAnalysis {
  questionResponseTime: number;
  speechLatency: number;
  processingTime: number;
  totalQuestionTime: number;
  isWithinTimeLimit: boolean;
  anomaliesDetected: string[];
}

/**
 * Timing Service class
 */
export class TimingService {
  private db: DatabaseInstance;
  private lastEventKey?: string;
  private lastEventTimestamp?: number;
  private lastEventId?: string;
  private static readonly DUPLICATE_WINDOW_MS = 1000;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  /**
   * Records a timing event with server-authoritative timestamp
   */
  async markTimingEvent(event: TimingEvent): Promise<string> {
    const serverTimestamp = this.getMonotonicTime();
    const eventKey = `${event.sessionQuestionId}_${event.eventType}`;

    if (
      this.lastEventKey === eventKey &&
      this.lastEventTimestamp !== undefined &&
      serverTimestamp - this.lastEventTimestamp < TimingService.DUPLICATE_WINDOW_MS
    ) {
      Logger.info('Duplicate timing event detected, skipping', {
        eventType: event.eventType,
        sessionQuestionId: event.sessionQuestionId,
      });
      return this.lastEventId as string;
    }

    const eventId = crypto.randomUUID();

    try {
      const networkLatency = event.clientSignalTimestamp
        ? this.calculateNetworkLatency(serverTimestamp, event.clientSignalTimestamp)
        : undefined;

      // Insert timing event into database
      await this.db.insert(questionTimings).values({
        id: eventId,
        sessionQuestionId: event.sessionQuestionId,
        eventType: event.eventType,
        serverTimestamp: serverTimestamp,
        clientSignalTimestamp: event.clientSignalTimestamp,
        networkLatency,
        metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      });

      await this.auditTimingEvent(eventId, event, serverTimestamp, networkLatency);

      Logger.info('Timing event recorded', {
        eventId,
        eventType: event.eventType,
        sessionQuestionId: event.sessionQuestionId,
        serverTimestamp,
        networkLatency,
      });

      this.lastEventKey = eventKey;
      this.lastEventTimestamp = serverTimestamp;
      this.lastEventId = eventId;

      return eventId;
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Handle duplicate timing events gracefully
      if (errorMessage.includes('UNIQUE constraint failed') &&
          errorMessage.includes('question_timings.session_question_id') &&
          errorMessage.includes('question_timings.event_type')) {

        Logger.info('Timing event already exists, skipping duplicate', {
          eventType: event.eventType,
          sessionQuestionId: event.sessionQuestionId,
        });

        // Return the existing event ID (we'll use a consistent format)
        return `${event.sessionQuestionId}_${event.eventType}_existing`;
      }

      // Log other errors as before
      Logger.error('Failed to record timing event', error as Error, {
        eventType: event.eventType,
        sessionQuestionId: event.sessionQuestionId,
      });
      throw new Error('Timing event recording failed');
    }
  }

  /**
   * Marks TTS start event
   */
  async markTTSStartEvent(
    sessionQuestionId: string,
    audioDuration: number,
    clientTimestamp?: number
  ): Promise<string> {
    return this.markTimingEvent({
      sessionQuestionId,
      eventType: 'tts_start',
      clientSignalTimestamp: clientTimestamp,
      metadata: {
        audioDuration,
        source: 'openai_realtime_api',
      },
    });
  }

  /**
   * Marks TTS end event (timer start)
   */
  async markTTSEndEvent(
    sessionQuestionId: string,
    clientTimestamp?: number
  ): Promise<string> {
    return this.markTimingEvent({
      sessionQuestionId,
      eventType: 'tts_end',
      clientSignalTimestamp: clientTimestamp,
      metadata: {
        timerStartTrigger: true,
      },
    });
  }

  /**
   * Marks speech start event
   */
  async markSpeechStartEvent(
    sessionQuestionId: string,
    vadThreshold: number,
    clientTimestamp?: number
  ): Promise<string> {
    return this.markTimingEvent({
      sessionQuestionId,
      eventType: 'speech_start',
      clientSignalTimestamp: clientTimestamp,
      metadata: {
        vadThreshold,
        detectionMethod: 'client_vad',
      },
    });
  }

  /**
   * Marks ASR received event
   */
  async markASRReceivedEvent(
    sessionQuestionId: string,
    transcript: string,
    confidence: number,
    clientTimestamp?: number
  ): Promise<string> {
    return this.markTimingEvent({
      sessionQuestionId,
      eventType: 'answer_received',
      clientSignalTimestamp: clientTimestamp,
      metadata: {
        transcript,
        confidence,
        finalTranscript: true,
      },
    });
  }

  /**
   * Calculates timer start time
   */
  async calculateTimerStart(sessionQuestionId: string): Promise<number | null> {
    try {
      const result = await this.db
        .select()
        .from(questionTimings)
        .where(
          and(
            eq(questionTimings.sessionQuestionId, sessionQuestionId),
            eq(questionTimings.eventType, 'tts_end')
          )
        )
        .limit(1);

      return result[0]?.serverTimestamp || null;
    } catch (error) {
      Logger.error('Failed to calculate timer start', error as Error);
      return null;
    }
  }

  /**
   * Calculates response time
   */
  async calculateResponseTime(sessionQuestionId: string): Promise<number | null> {
    try {
      const events = await this.db
        .select()
        .from(questionTimings)
        .where(
          and(
            eq(questionTimings.sessionQuestionId, sessionQuestionId),
            inArray(questionTimings.eventType, ['tts_end', 'answer_received'])
          )
        )
        .orderBy(questionTimings.serverTimestamp);

      Logger.info('Calculate response time - events found', {
        sessionQuestionId,
        eventsCount: events.length,
        events: events.map(e => ({ eventType: e.eventType, serverTimestamp: e.serverTimestamp }))
      });

      const ttsEnd = events.find(e => e.eventType === 'tts_end');
      const answerReceived = events.find(e => e.eventType === 'answer_received');

      if (!ttsEnd || !answerReceived) {
        Logger.warn('Missing timing events for response time calculation', {
          sessionQuestionId,
          hasTtsEnd: !!ttsEnd,
          hasAnswerReceived: !!answerReceived
        });
        return null;
      }

      const responseTime = answerReceived.serverTimestamp - ttsEnd.serverTimestamp;
      Logger.info('Response time calculated', {
        sessionQuestionId,
        responseTime,
        ttsEndTime: ttsEnd.serverTimestamp,
        answerReceivedTime: answerReceived.serverTimestamp
      });

      return responseTime;
    } catch (error) {
      Logger.error('Failed to calculate response time', error as Error);
      return null;
    }
  }

  /**
   * Gets detailed timing breakdown
   */
  async getTimingBreakdown(sessionQuestionId: string): Promise<TimingAnalysis | null> {
    try {
      const events = await this.db
        .select()
        .from(questionTimings)
        .where(eq(questionTimings.sessionQuestionId, sessionQuestionId))
        .orderBy(questionTimings.serverTimestamp);

      if (events.length === 0) {
        return null;
      }

      const eventMap = new Map(events.map(e => [e.eventType, e]));
      const ttsStart = eventMap.get('tts_start');
      const ttsEnd = eventMap.get('tts_end');
      const speechStart = eventMap.get('speech_start');
      const answerReceived = eventMap.get('answer_received');

      const questionResponseTime = ttsEnd && answerReceived ? answerReceived.serverTimestamp - ttsEnd.serverTimestamp : 0;
      const speechLatency = ttsEnd && speechStart ? speechStart.serverTimestamp - ttsEnd.serverTimestamp : 0;
      const processingTime = speechStart && answerReceived ? answerReceived.serverTimestamp - speechStart.serverTimestamp : 0;
      const totalQuestionTime = ttsStart && answerReceived ? answerReceived.serverTimestamp - ttsStart.serverTimestamp : 0;

      const anomalies = this.detectTimingAnomalies({
        questionResponseTime,
        speechLatency,
        processingTime,
        totalQuestionTime,
      });

      const timeLimit = await this.getQuestionTimeLimit(sessionQuestionId);
      const isWithinTimeLimit = questionResponseTime <= timeLimit * 1000;

      return {
        questionResponseTime,
        speechLatency,
        processingTime,
        totalQuestionTime,
        isWithinTimeLimit,
        anomaliesDetected: anomalies,
      };
    } catch (error) {
      Logger.error('Failed to get timing breakdown', error as Error);
      return null;
    }
  }

  /**
   * Detects timing anomalies
   */
  private detectTimingAnomalies(timings: {
    questionResponseTime: number;
    speechLatency: number;
    processingTime: number;
    totalQuestionTime: number;
  }): string[] {
    const anomalies: string[] = [];

    if (timings.questionResponseTime < 500) {
      anomalies.push('suspiciously_fast_response');
    }
    if (timings.speechLatency > 5000) {
      anomalies.push('delayed_speech_start');
    }
    if (timings.processingTime > 10000) {
      anomalies.push('extended_processing_time');
    }
    if (timings.speechLatency < 0 || timings.processingTime < 0) {
      anomalies.push('negative_timing_detected');
    }

    return anomalies;
  }

  /**
   * Gets monotonic time
   */
  private getMonotonicTime(): number {
    return Date.now();
  }

  /**
   * Calculates network latency
   */
  private calculateNetworkLatency(serverTime: number, clientTime: number): number {
    const diff = Math.abs(serverTime - clientTime);
    return Math.min(diff, 5000);
  }

  /**
   * Gets question time limit
   */
  private async getQuestionTimeLimit(sessionQuestionId: string): Promise<number> {
    try {
      const result = await this.db
        .select()
        .from(sessionQuestions)
        .innerJoin(questions, eq(sessionQuestions.questionId, questions.id))
        .where(eq(sessionQuestions.id, sessionQuestionId))
        .limit(1);

      return result[0]?.questions?.timeLimit || 30;
    } catch (error) {
      Logger.error('Failed to get question time limit', error as Error);
      return 30;
    }
  }

  /**
   * Creates audit log for timing event
   */
  private async auditTimingEvent(
    eventId: string,
    event: TimingEvent,
    serverTimestamp: number,
    networkLatency?: number
  ): Promise<void> {
    await this.db.insert(auditLogs).values({
      tableName: 'question_timings',
      recordId: eventId,
      action: 'INSERT',
      newValues: JSON.stringify({
        ...event,
        serverTimestamp,
        networkLatency,
      }),
      privacyImpact: 'timing_data',
    });
  }
}


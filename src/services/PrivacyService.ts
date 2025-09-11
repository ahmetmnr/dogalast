/**
 * Privacy Service
 * Handles KVKK compliance, data retention, consent, and user privacy
 */

import { eq, sql, lt, inArray } from 'drizzle-orm';

import {
  participants,
  quizSessions,
  dataProcessingActivities,
  consentRecords,
  auditLogs,
  sessionQuestions,
} from '@/db/schema';
import { Environment } from '@/utils/environment';
import { Logger } from '@/utils/logger';

import type { DatabaseInstance } from '@/db/connection';

/**
 * Data processing activity record
 */
interface DataProcessingRecord {
  participantId: number;
  activityType: 'registration' | 'quiz_participation' | 'audio_processing' | 'score_calculation' | 'leaderboard_display' | 'data_export';
  dataCategories: string[];
  processingPurpose: string;
  legalBasis: string;
  retentionPeriod: number;
}

/**
 * Privacy report interface
 */
export interface PrivacyReport {
  participantId: number;
  dataCategories: string[];
  processingActivities: string[];
  retentionPeriods: Record<string, number>;
  legalBasis: string;
  consentStatus: Record<string, boolean>;
  generatedAt: Date;
}

/**
 * Privacy Service class
 */
export class PrivacyService {
  private db: DatabaseInstance;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  /**
   * Handles audio data with privacy compliance
   */
  async handleAudioPrivacy(sessionQuestionId: string): Promise<void> {
    try {
      if (Environment.getAudioRetentionDays() > 0) {
        Logger.warn('Audio retention policy violation: audio should not be stored.');
      }

      await this.logDataProcessing({
        participantId: await this.getParticipantIdFromQuestion(sessionQuestionId),
        activityType: 'audio_processing',
        dataCategories: ['audio_data', 'performance_data'],
        processingPurpose: 'Yarışma cevabı analizi ve puanlama',
        legalBasis: 'Kullanıcı rızası (KVKK 6. Madde)',
        retentionPeriod: Environment.getTranscriptRetentionDays(),
      });

      Logger.info('Audio processed with privacy compliance', { sessionQuestionId });
    } catch (error) {
      Logger.error('Audio privacy handling failed', error as Error);
      throw error;
    }
  }

  /**
   * Enforces data retention policies
   */
  async enforceDataRetentionPolicies(): Promise<{ deleted: number; anonymized: number }> {
    let deleted = 0;
    let anonymized = 0;

    try {
      const dataCutoff = new Date();
      dataCutoff.setDate(dataCutoff.getDate() - Environment.getDataRetentionDays());
      const anonymizedCount = await this.anonymizeOldData(dataCutoff);
      anonymized += anonymizedCount;

      const auditCutoff = new Date();
      auditCutoff.setDate(auditCutoff.getDate() - 2555);
      const deletedLogsResult = await this.db.delete(auditLogs).where(lt(auditLogs.createdAt, auditCutoff));
      deleted += (deletedLogsResult as any).changes || 0;
      
      Logger.info('Data retention policies enforced', { deleted, anonymized });
      return { deleted, anonymized };
    } catch (error) {
      Logger.error('Failed to enforce data retention policies', error as Error);
      throw error;
    }
  }

  /**
   * Generates KVKK-compliant privacy report
   */
  async generatePrivacyReport(participantId: number): Promise<PrivacyReport> {
    try {
      const activities = await this.db.select().from(dataProcessingActivities).where(eq(dataProcessingActivities.participantId, participantId));
      const consents = await this.db.select().from(consentRecords).where(eq(consentRecords.participantId, participantId));

      const dataCategories = new Set<string>();
      const retentionPeriods: Record<string, number> = {};
      activities.forEach(act => {
        const cats = JSON.parse(act.dataCategories || '[]') as string[];
        cats.forEach(c => dataCategories.add(c));
        retentionPeriods[act.activityType] = act.retentionPeriod || 0;
      });

      const consentStatus: Record<string, boolean> = {};
      const latestConsents = new Map<string, boolean>();
      consents.forEach(con => {
        if (!latestConsents.has(con.consentType)) {
          latestConsents.set(con.consentType, con.consentGiven);
        }
      });
      latestConsents.forEach((val, key) => consentStatus[key] = val);

      return {
        participantId,
        dataCategories: Array.from(dataCategories),
        processingActivities: activities.map(a => a.activityType),
        retentionPeriods,
        legalBasis: 'Kullanıcı rızası (KVKK 6. Madde)',
        consentStatus,
        generatedAt: new Date(),
      };
    } catch (error) {
      Logger.error('Failed to generate privacy report', error as Error, { participantId });
      throw error;
    }
  }

  /**
   * Logs data processing activity
   */
  async logDataProcessing(record: DataProcessingRecord): Promise<void> {
    try {
      await this.db.insert(dataProcessingActivities).values({
        participantId: record.participantId,
        activityType: record.activityType,
        dataCategories: JSON.stringify(record.dataCategories),
        processingPurpose: record.processingPurpose,
        legalBasis: record.legalBasis,
        retentionPeriod: record.retentionPeriod,
        isAutomated: true,
      });
    } catch (error) {
      Logger.error('Failed to log data processing activity', error as Error);
    }
  }
  
  /**
   * Updates user consent
   */
  async updateConsent(
    participantId: number,
    consentType: string,
    consentGiven: boolean,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      await this.db.insert(consentRecords).values({
        participantId,
        consentType: consentType as any,
        consentGiven,
        consentVersion: '1.0',
        ipAddress,
        userAgent,
        withdrawalDate: !consentGiven ? new Date() : null,
      });
      Logger.info('Consent updated', { participantId, consentType, consentGiven });
    } catch (error) {
      Logger.error('Failed to update consent', error as Error, { participantId });
      throw error;
    }
  }

  /**
   * Anonymizes user data
   */
  async anonymizeData(participantId: number, dataCategories: string[]): Promise<void> {
    try {
      if (dataCategories.includes('personal_data')) {
        await this.db.update(participants).set({
          name: sql`'anonymized-' || ${participants.id}`,
          email: null,
          phone: null,
        }).where(eq(participants.id, participantId));
      }
      
      Logger.info('Data anonymized', { participantId, dataCategories });
    } catch (error) {
      Logger.error('Failed to anonymize data', error as Error);
      throw error;
    }
  }

  private async getParticipantIdFromQuestion(sessionQuestionId: string): Promise<number> {
    const result = await this.db
      .select()
      .from(sessionQuestions)
      .innerJoin(quizSessions, eq(sessionQuestions.sessionId, quizSessions.id))
      .where(eq(sessionQuestions.id, sessionQuestionId))
      .limit(1);
    
    if (!result[0]) throw new Error('Participant not found for session question');
    return result[0].quiz_sessions.participantId;
  }
  
  private async anonymizeOldData(cutoffDate: Date): Promise<number> {
    const oldSessions = await this.db.select().from(quizSessions).where(lt(quizSessions.lastActivityAt, cutoffDate));
    
    const participantIds = oldSessions.map(s => s.participantId);
    if(participantIds.length === 0) return 0;
    
    const result = await this.db.update(participants).set({
      name: sql`'anonymized-' || ${participants.id}`,
      email: null,
      phone: null,
    }).where(inArray(participants.id, participantIds));
    
    return (result as any).changes || 0;
  }
}


/**
 * Scoring Service
 * Deterministic scoring with fuzzy matching and tie-breaking for leaderboard
 */

import { eq, desc, asc, sql } from 'drizzle-orm';
import {
  participants,
  quizSessions,
  sessionQuestions,
  questions,
} from '@/db/schema';
import { Logger } from '@/utils/logger';

const logger = new Logger('scoring-service');
import type { DatabaseInstance } from '@/db/connection';

interface AnswerValidationResult {
  isCorrect: boolean;
  matchType: 'exact' | 'fuzzy' | 'partial' | 'none';
  similarity: number; // 0-1 arası
  normalizedUserAnswer: string;
  normalizedCorrectAnswer: string;
}

interface ScoreCalculationResult {
  basePoints: number;
  timeBonus: number;
  streakMultiplier: number;
  difficultyMultiplier: number;
  finalScore: number;
  breakdown: {
    basePts: number;
    timeBonusPts: number;
    streakBonusPts: number;
    difficultyBonusPts: number;
  };
}

export interface LeaderboardEntry {
  participantId: number;
  participantName: string;
  totalScore: number;
  completedAt: Date;
  lastActivityAt: Date;
  questionsAnswered: number;
  correctAnswers: number;
  averageResponseTime: number;
  rank: number;
}

export class ScoringService {
  private db: DatabaseInstance;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  /**
   * Validate user answer against correct answer
   */
  validateAnswer(userAnswer: string, correctAnswer: string): AnswerValidationResult {
    const normalizedUser = this.normalizeAnswer(userAnswer);
    const normalizedCorrect = this.normalizeAnswer(correctAnswer);

    // Exact match
    if (normalizedUser === normalizedCorrect) {
      return {
        isCorrect: true,
        matchType: 'exact',
        similarity: 1.0,
        normalizedUserAnswer: normalizedUser,
        normalizedCorrectAnswer: normalizedCorrect,
      };
    }

    // Fuzzy matching with Levenshtein distance
    const similarity = this.calculateSimilarity(normalizedUser, normalizedCorrect);
    
    if (similarity >= 0.85) {
      return {
        isCorrect: true,
        matchType: 'fuzzy',
        similarity,
        normalizedUserAnswer: normalizedUser,
        normalizedCorrectAnswer: normalizedCorrect,
      };
    } else if (similarity >= 0.6) {
      return {
        isCorrect: false,
        matchType: 'partial',
        similarity,
        normalizedUserAnswer: normalizedUser,
        normalizedCorrectAnswer: normalizedCorrect,
      };
    } else {
      return {
        isCorrect: false,
        matchType: 'none',
        similarity,
        normalizedUserAnswer: normalizedUser,
        normalizedCorrectAnswer: normalizedCorrect,
      };
    }
  }


  /**
   * Get leaderboard with tie-breaking
   */
  async getLeaderboardWithTieBreaking(limit: number = 50, offset: number = 0): Promise<LeaderboardEntry[]> {
    try {
      const leaderboardData = await this.db
        .select()
        .from(quizSessions)
        .innerJoin(participants, eq(quizSessions.participantId, participants.id))
        .leftJoin(sessionQuestions, eq(sessionQuestions.sessionId, quizSessions.id))
        .where(eq(quizSessions.status, 'completed'))
        .groupBy(participants.id, quizSessions.id)
        .orderBy(
          desc(quizSessions.totalScore),
          asc(quizSessions.completedAt), // Tie-breaker: earlier completion wins
          desc(sql<number>`avg(${sessionQuestions.responseTime})`) // Second tie-breaker: faster average response
        )
        .limit(limit)
        .offset(offset);

      // Add ranks with proper tie handling
      const rankedEntries: LeaderboardEntry[] = [];
      let currentRank = offset + 1;
      let previousScore = null;
      let previousCompletionTime = null;

      for (let i = 0; i < leaderboardData.length; i++) {
        const entry = leaderboardData[i];
        if (!entry) continue;
        
        // Check if this entry has the same score and completion time as previous
        if (previousScore !== null && 
            entry.quiz_sessions.totalScore === previousScore &&
            entry.quiz_sessions.completedAt?.getTime() === (previousCompletionTime as Date)?.getTime()) {
          // Same rank as previous entry
        } else {
          // New rank
          currentRank = offset + i + 1;
        }

        rankedEntries.push({
          rank: currentRank,
          participantId: entry.participants.id,
          participantName: entry.participants.name,
          totalScore: entry.quiz_sessions.totalScore,
          completedAt: entry.quiz_sessions.completedAt || new Date(),
          lastActivityAt: entry.quiz_sessions.lastActivityAt,
          questionsAnswered: entry.quiz_sessions.questionsAnswered,
          correctAnswers: entry.quiz_sessions.correctAnswers,
          averageResponseTime: 0, // Will be calculated separately
        });

        previousScore = entry.quiz_sessions.totalScore;
        previousCompletionTime = entry.quiz_sessions.completedAt;
      }

      return rankedEntries;

    } catch (error) {
      logger.error('Failed to get leaderboard', error as Error);
      throw new Error('Leaderboard calculation failed');
    }
  }

  /**
   * Detect scoring anomalies for anti-cheat
   */
  detectScoringAnomalies(
    responseTime: number,
    timeLimit: number,
    streak: number,
    recentScores: number[]
  ): string[] {
    const anomalies: string[] = [];

    // Suspiciously fast responses
    if (responseTime < 1000) {
      anomalies.push('suspiciously_fast_response');
    }

    // Impossible perfect streaks
    if (streak > 10) {
      anomalies.push('impossible_streak');
    }

    // Sudden score improvements
    if (recentScores.length >= 3) {
      const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
      const lastScore = recentScores[recentScores.length - 1];
      
      if (lastScore !== undefined && lastScore > avgRecent * 3) {
        anomalies.push('sudden_improvement');
      }
    }

    // Response time patterns
    const responseTimeSeconds = responseTime / 1000;
    if (responseTimeSeconds > timeLimit * 0.95) {
      anomalies.push('time_limit_abuse');
    }

    return anomalies;
  }

  /**
   * Get participant's current streak
   */
  async getCurrentStreak(sessionId: string): Promise<number> {
    try {
      const recentAnswers = await this.db
        .select()
        .from(sessionQuestions)
        .where(eq(sessionQuestions.sessionId, sessionId))
        .orderBy(desc(sessionQuestions.answeredAt))
        .limit(10);

      let streak = 0;
      for (const answer of recentAnswers) {
        if (answer.isCorrect) {
          streak++;
        } else {
          break;
        }
      }

      return streak;
    } catch (error) {
      logger.error('Failed to get current streak', error as Error);
      return 0;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Normalize answer for comparison
   */
  private normalizeAnswer(answer: string): string {
    return answer
      .toLowerCase()
      .trim()
      // Turkish character normalization
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      // Remove punctuation and extra spaces
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate similarity using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;

    const distance = this.levenshteinDistance(str1, str2);
    return (maxLength - distance) / maxLength;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0]![i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j]![0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j]![i - 1]! + 1, // deletion
          matrix[j - 1]![i]! + 1, // insertion
          matrix[j - 1]![i - 1]! + indicator // substitution
        );
      }
    }

    return matrix[str2.length]![str1.length]!;
  }

  /**
   * Get leaderboard with deterministic tie-breaking
   * @param limit Number of entries to return
   * @returns Promise<LeaderboardEntry[]>
   */
  async getLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
    try {
      return await this.getLeaderboardWithTieBreaking(limit);
    } catch (error) {
      logger.error('Failed to get leaderboard', error as Error);
      throw error;
    }
  }

  /**
   * Calculate score with all bonuses
   * @param sessionQuestionId Session question ID
   * @param validationResult Answer validation result
   * @param responseTime Response time in milliseconds
   * @param timeLimitMs Time limit in milliseconds
   * @param difficulty Question difficulty (1-5)
   * @returns Promise<ScoreCalculationResult>
   */
  async calculateScore(
    sessionQuestionId: string,
    validationResult: AnswerValidationResult,
    responseTime: number,
    timeLimitMs: number,
    difficulty: number = 1
  ): Promise<ScoreCalculationResult> {
    try {
      // Get question info
      const questionInfo = await this.getQuestionInfo(sessionQuestionId);
      if (!questionInfo) {
        throw new Error('Question info not found');
      }

      // Base points calculation
      let basePoints = questionInfo.questions.basePoints;
      
      // Apply match type multiplier
      switch (validationResult.matchType) {
        case 'exact':
          basePoints = basePoints * 1.0;
          break;
        case 'fuzzy':
          basePoints = Math.floor(basePoints * 0.9);
          break;
        case 'partial':
          basePoints = Math.floor(basePoints * 0.5);
          break;
        case 'none':
          basePoints = 0;
          break;
      }

      // Time bonus calculation
      const timeBonus = this.calculateTimeBonus(basePoints, responseTime, timeLimitMs);
      
      // Streak multiplier
      const currentStreak = await this.getCurrentStreak(sessionQuestionId);
      const streakMultiplier = this.calculateStreakMultiplier(currentStreak);
      
      // Difficulty multiplier
      const difficultyMultiplier = this.calculateDifficultyMultiplier(difficulty);
      
      // Final calculation
      const baseWithTimeBonus = basePoints + timeBonus;
      const withStreak = Math.floor(baseWithTimeBonus * streakMultiplier);
      const finalScore = Math.floor(withStreak * difficultyMultiplier);

      const breakdown = {
        basePts: basePoints,
        timeBonusPts: timeBonus,
        streakBonusPts: withStreak - baseWithTimeBonus,
        difficultyBonusPts: finalScore - withStreak
      };

      logger.info('Score calculated', {
        sessionQuestionId,
        basePoints,
        timeBonus,
        streakMultiplier,
        difficultyMultiplier,
        finalScore,
        responseTime
      });

      return {
        basePoints,
        timeBonus,
        streakMultiplier,
        difficultyMultiplier,
        finalScore,
        breakdown
      };
    } catch (error) {
      logger.error('Score calculation failed', error as Error);
      throw error;
    }
  }

  /**
   * Get question info for scoring
   */
  private async getQuestionInfo(sessionQuestionId: string) {
    const result = await this.db
      .select()
      .from(sessionQuestions)
      .innerJoin(questions, eq(sessionQuestions.questionId, questions.id))
      .where(eq(sessionQuestions.id, sessionQuestionId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Calculate time bonus
   */
  private calculateTimeBonus(basePoints: number, responseTime: number, timeLimitMs: number): number {
    if (responseTime >= timeLimitMs) return 0;
    const timeRatio = responseTime / timeLimitMs;
    const bonusRatio = Math.max(0, (1 - timeRatio) * 0.5); // 0-0.5 range
    return Math.floor(basePoints * bonusRatio);
  }

  /**
   * Calculate streak multiplier
   */
  private calculateStreakMultiplier(streak: number): number {
    if (streak < 2) return 1.0;
    if (streak < 3) return 1.2;
    if (streak < 4) return 1.5;
    if (streak < 5) return 2.0;
    return 2.5; // Max 2.5x multiplier
  }

  /**
   * Calculate difficulty multiplier
   */
  private calculateDifficultyMultiplier(difficulty: number): number {
    const multipliers = [1.0, 1.0, 1.2, 1.5, 2.0, 2.5];
    return multipliers[difficulty] || 1.0;
  }
}


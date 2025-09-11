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
   * Calculate score for an answer
   */
  calculateScore(
    isCorrect: boolean,
    basePoints: number,
    responseTimeMs: number,
    timeLimitMs: number,
    difficulty: number,
    currentStreak: number = 0
  ): ScoreCalculationResult {
    let finalScore = 0;
    const breakdown = {
      basePts: 0,
      timeBonusPts: 0,
      streakBonusPts: 0,
      difficultyBonusPts: 0,
    };

    if (!isCorrect) {
      return {
        basePoints: 0,
        timeBonus: 0,
        streakMultiplier: 0,
        difficultyMultiplier: 0,
        finalScore: 0,
        breakdown,
      };
    }

    // Base points
    breakdown.basePts = basePoints;
    finalScore += basePoints;

    // Time bonus (faster answers get bonus)
    const timePercentage = responseTimeMs / timeLimitMs;
    if (timePercentage <= 0.5) {
      // Very fast (under 50% of time limit)
      breakdown.timeBonusPts = Math.round(basePoints * 0.5);
    } else if (timePercentage <= 0.7) {
      // Fast (under 70% of time limit)
      breakdown.timeBonusPts = Math.round(basePoints * 0.3);
    } else if (timePercentage <= 0.9) {
      // Normal speed (under 90% of time limit)
      breakdown.timeBonusPts = Math.round(basePoints * 0.1);
    }
    finalScore += breakdown.timeBonusPts;

    // Streak bonus
    if (currentStreak >= 3) {
      breakdown.streakBonusPts = Math.round(basePoints * 0.2 * Math.min(currentStreak / 5, 2));
      finalScore += breakdown.streakBonusPts;
    }

    // Difficulty multiplier
    if (difficulty >= 4) {
      breakdown.difficultyBonusPts = Math.round(basePoints * (difficulty - 3) * 0.1);
      finalScore += breakdown.difficultyBonusPts;
    }

    return {
      basePoints,
      timeBonus: breakdown.timeBonusPts,
      streakMultiplier: breakdown.streakBonusPts,
      difficultyMultiplier: breakdown.difficultyBonusPts,
      finalScore,
      breakdown,
    };
  }

  /**
   * Get leaderboard with tie-breaking
   */
  async getLeaderboardWithTieBreaking(limit: number = 50, offset: number = 0): Promise<LeaderboardEntry[]> {
    try {
      const leaderboardData = await this.db
        .select({
          participantId: participants.id,
          participantName: participants.name,
          totalScore: quizSessions.totalScore,
          completedAt: quizSessions.completedAt,
          lastActivityAt: quizSessions.lastActivityAt,
          questionsAnswered: sql<number>`count(${sessionQuestions.id})`.as('questionsAnswered'),
          correctAnswers: sql<number>`sum(case when ${sessionQuestions.isCorrect} then 1 else 0 end)`.as('correctAnswers'),
          averageResponseTime: sql<number>`avg(${sessionQuestions.responseTime})`.as('averageResponseTime'),
        })
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
        
        // Check if this entry has the same score and completion time as previous
        if (previousScore !== null && 
            entry.totalScore === previousScore && 
            entry.completedAt?.getTime() === previousCompletionTime?.getTime()) {
          // Same rank as previous entry
        } else {
          // New rank
          currentRank = offset + i + 1;
        }

        rankedEntries.push({
          ...entry,
          rank: currentRank,
          completedAt: entry.completedAt || new Date(),
          averageResponseTime: entry.averageResponseTime || 0,
        });

        previousScore = entry.totalScore;
        previousCompletionTime = entry.completedAt;
      }

      return rankedEntries;

    } catch (error) {
      Logger.error('Failed to get leaderboard', error as Error);
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
      
      if (lastScore > avgRecent * 3) {
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
        .select({ isCorrect: sessionQuestions.isCorrect })
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
      Logger.error('Failed to get current streak', error as Error);
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
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }
}

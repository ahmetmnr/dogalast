/**
 * Token Service
 * Ephemeral token management for OpenAI Realtime API
 */

import { CryptoUtils, type JWTPayload } from '@/utils/crypto';
import { Logger } from '@/utils/logger';
import { Environment } from '@/utils/environment';

interface EphemeralTokenData {
  sessionId: string;
  participantId: number;
  permissions: string[];
  realtimeEndpoint: string;
  expiresAt: Date;
}

interface TokenRefreshResult {
  newToken: string;
  expiresIn: number; // seconds
  refreshNeeded: boolean;
  error?: string;
}

interface TokenValidationResult {
  isValid: boolean;
  isExpiring: boolean; // Within refresh threshold
  remainingTime: number; // seconds
  error?: string;
}

export class TokenService {
  private static readonly EPHEMERAL_TOKEN_LIFETIME = 3600; // 1 hour in seconds
  private static readonly REFRESH_THRESHOLD = 0.75; // Refresh when 75% of lifetime elapsed
  private static readonly CLEANUP_INTERVAL = 300000; // 5 minutes in ms

  private static tokenStorage = new Map<string, EphemeralTokenData>();
  private static cleanupTimer: Timer | null = null;
  private static _isInitialized = false;

  /**
   * Check if service is initialized
   */
  static get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Initialize token service
   */
  static initialize(): void {
    if (this._isInitialized) {
      return;
    }

    // Start cleanup timer
    this.startCleanupTimer();
    this._isInitialized = true;
    
    Logger.info('Token service initialized');
  }

  /**
   * Generate ephemeral token for OpenAI Realtime API
   */
  static async generateEphemeralToken(
    sessionId: string,
    participantId: number,
    permissions: string[] = ['realtime_audio', 'tool_dispatch']
  ): Promise<string> {
    try {
      const expiresAt = new Date(Date.now() + this.EPHEMERAL_TOKEN_LIFETIME * 1000);
      
      // Create JWT payload
      const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
        sub: participantId.toString(),
        role: 'user',
        permissions,
        sessionId
      };

      // Generate JWT token
      const token = await CryptoUtils.generateSecureJWT(
        payload,
        `${this.EPHEMERAL_TOKEN_LIFETIME}s`,
        Environment.getJWTSecret()
      );

      // Store token data
      const tokenData: EphemeralTokenData = {
        sessionId,
        participantId,
        permissions,
        realtimeEndpoint: 'https://api.openai.com/v1/realtime',
        expiresAt
      };

      this.tokenStorage.set(token, tokenData);

      Logger.info('Ephemeral token generated', {
        sessionId,
        participantId,
        expiresAt: expiresAt.toISOString()
      });

      return token;

    } catch (error) {
      Logger.error('Failed to generate ephemeral token', error as Error, {
        sessionId,
        participantId
      });
      throw new Error('Token generation failed');
    }
  }

  /**
   * Refresh ephemeral token
   */
  static async refreshEphemeralToken(
    currentToken: string,
    sessionId: string
  ): Promise<TokenRefreshResult> {
    try {
      // Validate current token
      const validation = await this.validateTokenExpiry(currentToken);
      
      if (!validation.isValid) {
        return {
          newToken: '',
          expiresIn: 0,
          refreshNeeded: false,
          error: 'Current token is invalid'
        };
      }

      // Get token data
      const tokenData = this.tokenStorage.get(currentToken);
      if (!tokenData) {
        return {
          newToken: '',
          expiresIn: 0,
          refreshNeeded: false,
          error: 'Token data not found'
        };
      }

      // Verify session ID matches
      if (tokenData.sessionId !== sessionId) {
        return {
          newToken: '',
          expiresIn: 0,
          refreshNeeded: false,
          error: 'Session ID mismatch'
        };
      }

      // Generate new token
      const newToken = await this.generateEphemeralToken(
        tokenData.sessionId,
        tokenData.participantId,
        tokenData.permissions
      );

      // Revoke old token
      this.revokeToken(currentToken);

      Logger.info('Ephemeral token refreshed', {
        sessionId,
        participantId: tokenData.participantId
      });

      return {
        newToken,
        expiresIn: this.EPHEMERAL_TOKEN_LIFETIME,
        refreshNeeded: false
      };

    } catch (error) {
      Logger.error('Failed to refresh ephemeral token', error as Error, {
        sessionId
      });

      return {
        newToken: '',
        expiresIn: 0,
        refreshNeeded: false,
        error: 'Token refresh failed'
      };
    }
  }

  /**
   * Validate token expiry
   */
  static async validateTokenExpiry(token: string): Promise<TokenValidationResult> {
    try {
      // Verify JWT
      const payload = await CryptoUtils.verifyJWT(token, Environment.getJWTSecret());
      
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = payload.exp || 0;
      const issuedAt = payload.iat || 0;
      
      if (expiresAt <= now) {
        return {
          isValid: false,
          isExpiring: false,
          remainingTime: 0,
          error: 'Token expired'
        };
      }

      const remainingTime = expiresAt - now;
      const totalLifetime = expiresAt - issuedAt;
      const elapsedPercentage = totalLifetime > 0 ? (now - issuedAt) / totalLifetime : 1;
      
      const isExpiring = elapsedPercentage >= this.REFRESH_THRESHOLD;

      return {
        isValid: true,
        isExpiring,
        remainingTime,
      };

    } catch (error) {
      Logger.error('Token validation failed', error as Error);
      
      return {
        isValid: false,
        isExpiring: false,
        remainingTime: 0,
        error: 'Token validation failed'
      };
    }
  }

  /**
   * Revoke token
   */
  static revokeToken(token: string): boolean {
    try {
      const deleted = this.tokenStorage.delete(token);
      
      if (deleted) {
        Logger.info('Token revoked', { token: token.substring(0, 10) + '...' });
      }
      
      return deleted;

    } catch (error) {
      Logger.error('Failed to revoke token', error as Error);
      return false;
    }
  }

  /**
   * Cleanup expired tokens
   */
  static cleanupExpiredTokens(): number {
    try {
      const now = new Date();
      let cleanedCount = 0;

      for (const [token, data] of this.tokenStorage.entries()) {
        if (data.expiresAt <= now) {
          this.tokenStorage.delete(token);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        Logger.info('Expired tokens cleaned up', { cleanedCount });
      }

      return cleanedCount;

    } catch (error) {
      Logger.error('Token cleanup failed', error as Error);
      return 0;
    }
  }

  /**
   * Start cleanup timer
   */
  private static startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredTokens();
    }, this.CLEANUP_INTERVAL) as unknown as Timer;
  }

  /**
   * Stop cleanup timer
   */
  static stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

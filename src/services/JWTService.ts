/**
 * JWT Service
 * JSON Web Token generation and validation using jose library
 */

import { SignJWT, jwtVerify } from 'jose';

import { Environment } from '@/utils/environment';
import { Logger } from '@/utils/logger';

/**
 * JWT payload interface
 */
export interface JWTPayload {
  sub: string; // Subject (User ID)
  role: 'user' | 'admin' | 'super_admin';
  permissions: string[];
  sessionId?: string;
  participantId?: number;
  iat?: number; // Issued at
  exp?: number; // Expiration
  iss?: string; // Issuer
  aud?: string; // Audience
  jti?: string; // JWT ID (for refresh tokens)
}

/**
 * Token pair for access and refresh tokens
 */
export interface TokenPair {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: 'Bearer';
  refreshExpiresIn?: number;
}

/**
 * Token verification result
 */
export interface TokenVerificationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
  expired?: boolean;
}

/**
 * Authentication errors
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string = 'AUTHENTICATION_ERROR',
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public code: string = 'AUTHORIZATION_ERROR',
    public statusCode: number = 403
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * JWT Service for token management
 */
export class JWTService {
  private static readonly ALGORITHM = 'HS256';
  private static readonly ISSUER = 'zero-waste-quiz';
  
  // Token expiration times
  private static readonly USER_TOKEN_EXPIRY = 3600; // 1 hour
  private static readonly ADMIN_TOKEN_EXPIRY = 900; // 15 minutes
  private static readonly REFRESH_TOKEN_EXPIRY = 86400 * 7; // 7 days
  
  /**
   * Get JWT secret from environment
   */
  private static getSecret(): Uint8Array {
    const secret = Environment.getJWTSecret();
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    
    // Convert string to Uint8Array for jose
    return new TextEncoder().encode(secret);
  }
  
  /**
   * Get Admin JWT secret from environment
   */
  private static getAdminSecret(): Uint8Array {
    const secret = Environment.getAdminJWTSecret();
    if (!secret) {
      // Fallback to regular JWT secret if admin secret not set
      return this.getSecret();
    }
    
    return new TextEncoder().encode(secret);
  }
  
  /**
   * Generate access and refresh tokens
   */
  static async generateTokenPair(
    payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'aud'>
  ): Promise<TokenPair> {
    const now = Math.floor(Date.now() / 1000);
    const isAdmin = payload.role !== 'user';
    const expiresIn = isAdmin ? this.ADMIN_TOKEN_EXPIRY : this.USER_TOKEN_EXPIRY;
    const secret = isAdmin ? this.getAdminSecret() : this.getSecret();
    
    // Generate access token
    const accessToken = await new SignJWT({
      ...payload,
      iss: this.ISSUER,
      aud: isAdmin ? 'admins' : 'participants',
    })
      .setProtectedHeader({ alg: this.ALGORITHM })
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .setJti(crypto.randomUUID())
      .sign(secret);
    
    // Generate refresh token (optional)
    let refreshToken: string | undefined;
    let refreshExpiresIn: number | undefined;
    
    if (!isAdmin) { // Only generate refresh tokens for regular users
      refreshExpiresIn = this.REFRESH_TOKEN_EXPIRY;
      refreshToken = await new SignJWT({
        sub: payload.sub,
        role: payload.role,
        type: 'refresh',
        sessionId: payload.sessionId,
      })
        .setProtectedHeader({ alg: this.ALGORITHM })
        .setIssuedAt(now)
        .setExpirationTime(now + refreshExpiresIn)
        .setJti(crypto.randomUUID())
        .sign(secret);
    }
    
    return {
      accessToken,
      refreshToken,
      expiresIn,
      refreshExpiresIn,
      tokenType: 'Bearer'
    };
  }
  
  /**
   * Generate a simple access token (no refresh)
   */
  static async generateToken(
    payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'aud'>
  ): Promise<string> {
    const { accessToken } = await this.generateTokenPair(payload);
    return accessToken;
  }
  
  /**
   * Verify and decode a token
   */
  static async verifyToken(
    token: string,
    options?: { isAdmin?: boolean }
  ): Promise<JWTPayload> {
    try {
      const secret = options?.isAdmin ? this.getAdminSecret() : this.getSecret();
      
      const { payload } = await jwtVerify(token, secret, {
        issuer: this.ISSUER,
        algorithms: [this.ALGORITHM],
      });
      
      // Validate audience if specified
      if (options?.isAdmin && payload.aud !== 'admins') {
        throw new AuthenticationError('Invalid token audience', 'INVALID_AUDIENCE');
      }
      
      return payload as JWTPayload;
    } catch (error: any) {
      if (error.code === 'ERR_JWT_EXPIRED') {
        throw new AuthenticationError('Token expired', 'TOKEN_EXPIRED');
      }
      
      if (error.code === 'ERR_JWT_INVALID') {
        throw new AuthenticationError('Invalid token', 'INVALID_TOKEN');
      }
      
      if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
        throw new AuthenticationError('Invalid token signature', 'INVALID_SIGNATURE');
      }
      
      Logger.error('JWT verification error', error);
      throw new AuthenticationError('Token verification failed', 'VERIFICATION_FAILED');
    }
  }
  
  /**
   * Verify token without throwing errors
   */
  static async safeVerifyToken(
    token: string,
    options?: { isAdmin?: boolean }
  ): Promise<TokenVerificationResult> {
    try {
      const payload = await this.verifyToken(token, options);
      return { valid: true, payload };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return {
          valid: false,
          error: error.message,
          expired: error.code === 'TOKEN_EXPIRED'
        };
      }
      
      return { valid: false, error: 'Unknown error' };
    }
  }
  
  /**
   * Check if token is expiring soon
   */
  static isTokenExpiringSoon(payload: JWTPayload): boolean {
    if (!payload.exp || !payload.iat) {
      return true; // Consider it expiring if no exp/iat
    }
    
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = payload.exp - now;
    const totalLifetime = payload.exp - payload.iat;
    const threshold = Environment.getTokenRefreshThreshold();
    
    return timeUntilExpiry < (totalLifetime * threshold);
  }
  
  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader?: string): string {
    if (!authHeader) {
      throw new AuthenticationError(
        'Missing authorization header',
        'MISSING_AUTH_HEADER'
      );
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError(
        'Invalid authorization header format',
        'INVALID_AUTH_HEADER'
      );
    }
    
    const token = authHeader.substring(7);
    
    if (!token) {
      throw new AuthenticationError(
        'Empty token',
        'EMPTY_TOKEN'
      );
    }
    
    return token;
  }
  
  /**
   * Generate ephemeral token for OpenAI
   */
  static async generateEphemeralToken(
    sessionId: string,
    userId: string,
    expiresIn: number = 300 // 5 minutes default
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    
    const token = await new SignJWT({
      sub: userId,
      sessionId,
      type: 'ephemeral',
      scope: 'openai.realtime',
    })
      .setProtectedHeader({ alg: this.ALGORITHM })
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .setJti(crypto.randomUUID())
      .sign(this.getSecret());
    
    return token;
  }
  
  /**
   * Refresh an access token using a refresh token
   */
  static async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    try {
      // Verify refresh token
      const payload = await this.verifyToken(refreshToken);
      
      // Check if it's a refresh token
      if ((payload as any).type !== 'refresh') {
        throw new AuthenticationError('Not a refresh token', 'INVALID_TOKEN_TYPE');
      }
      
      // Generate new token pair with same user info
      return await this.generateTokenPair({
        sub: payload.sub,
        role: payload.role,
        permissions: payload.permissions || [],
        sessionId: payload.sessionId,
        participantId: payload.participantId,
      });
    } catch (error) {
      Logger.error('Token refresh failed', error as Error);
      throw new AuthenticationError('Failed to refresh token', 'REFRESH_FAILED');
    }
  }
  
  /**
   * Revoke a token (for logout/security)
   * Note: This requires a token blacklist implementation in production
   */
  static async revokeToken(token: string): Promise<void> {
    try {
      const payload = await this.verifyToken(token);
      
      // In production, add token JTI to blacklist
      Logger.info('Token revoked', {
        jti: (payload as any).jti,
        sub: payload.sub,
        exp: payload.exp
      });
      
      // TODO: Implement token blacklist storage
    } catch (error) {
      // Even if token is invalid, consider it revoked
      Logger.debug('Attempted to revoke invalid token');
    }
  }
}

/**
 * Permission constants
 */
export enum Permission {
  // Quiz permissions
  PARTICIPATE_QUIZ = 'quiz:participate',
  VIEW_LEADERBOARD = 'quiz:view_leaderboard',
  
  // Question management
  VIEW_QUESTIONS = 'questions:view',
  CREATE_QUESTIONS = 'questions:create',
  UPDATE_QUESTIONS = 'questions:update',
  DELETE_QUESTIONS = 'questions:delete',
  
  // User management
  VIEW_USERS = 'users:view',
  MANAGE_USERS = 'users:manage',
  DELETE_USER_DATA = 'users:delete_data',
  EXPORT_USER_DATA = 'users:export_data',
  
  // Admin management
  VIEW_ADMINS = 'admins:view',
  CREATE_ADMINS = 'admins:create',
  UPDATE_ADMINS = 'admins:update',
  DELETE_ADMINS = 'admins:delete',
  
  // System management
  VIEW_AUDIT_LOGS = 'system:view_audit_logs',
  MANAGE_SETTINGS = 'system:manage_settings',
  VIEW_ANALYTICS = 'system:view_analytics',
  
  // Privacy management
  VIEW_PRIVACY_DATA = 'privacy:view_data',
  MANAGE_CONSENT = 'privacy:manage_consent',
  PROCESS_DELETION_REQUESTS = 'privacy:process_deletions',
}

/**
 * Permission manager for role-based access
 */
export class PermissionManager {
  private static readonly ROLE_PERMISSIONS: Record<string, Permission[]> = {
    user: [
      Permission.PARTICIPATE_QUIZ,
      Permission.VIEW_LEADERBOARD
    ],
    admin: [
      Permission.PARTICIPATE_QUIZ,
      Permission.VIEW_LEADERBOARD,
      Permission.VIEW_QUESTIONS,
      Permission.CREATE_QUESTIONS,
      Permission.UPDATE_QUESTIONS,
      Permission.DELETE_QUESTIONS,
      Permission.VIEW_USERS,
      Permission.EXPORT_USER_DATA,
      Permission.VIEW_AUDIT_LOGS,
      Permission.VIEW_PRIVACY_DATA,
    ],
    super_admin: [
      ...Object.values(Permission) // All permissions
    ]
  };
  
  /**
   * Get permissions for a role
   */
  static getRolePermissions(role: string): Permission[] {
    return this.ROLE_PERMISSIONS[role] || [];
  }
  
  /**
   * Check if user has a specific permission
   */
  static hasPermission(
    userPermissions: string[],
    requiredPermission: Permission
  ): boolean {
    return userPermissions.includes(requiredPermission);
  }
  
  /**
   * Check if user has any of the required permissions
   */
  static hasAnyPermission(
    userPermissions: string[],
    requiredPermissions: Permission[]
  ): boolean {
    return requiredPermissions.some(permission => 
      userPermissions.includes(permission)
    );
  }
  
  /**
   * Check if user has all required permissions
   */
  static hasAllPermissions(
    userPermissions: string[],
    requiredPermissions: Permission[]
  ): boolean {
    return requiredPermissions.every(permission => 
      userPermissions.includes(permission)
    );
  }
  
  /**
   * Add permissions to a user's permission set
   */
  static addPermissions(
    currentPermissions: string[],
    newPermissions: Permission[]
  ): string[] {
    const permissionSet = new Set([...currentPermissions, ...newPermissions]);
    return Array.from(permissionSet);
  }
  
  /**
   * Remove permissions from a user's permission set
   */
  static removePermissions(
    currentPermissions: string[],
    permissionsToRemove: Permission[]
  ): string[] {
    const removeSet = new Set(permissionsToRemove);
    return currentPermissions.filter(p => !removeSet.has(p as Permission));
  }
}


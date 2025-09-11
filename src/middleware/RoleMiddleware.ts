/**
 * Role-Based Access Control Middleware
 * JWT authentication and role/permission-based authorization
 */

import { Context, Next } from 'hono';

import { BaseMiddleware } from './BaseMiddleware';
import { JWTService, Permission, PermissionManager } from '@/services/JWTService';
import { Logger } from '@/utils/logger';

/**
 * User context interface
 */
export interface UserContext {
  id: string;
  role: 'user' | 'admin' | 'super_admin';
  permissions: string[];
  sessionId?: string;
  participantId?: number;
}

/**
 * Authentication middleware
 * Validates JWT tokens and populates user context
 */
export class AuthenticationMiddleware extends BaseMiddleware {
  private static readonly PUBLIC_PATHS = [
    '/health',
    '/api/register',
    '/api/auth/login',
    '/api/admin/login',
    '/api/public/*'
  ];
  
  async handle(c: Context, next: Next): Promise<Response | void> {
    // Check if path is public
    if (this.isPublicPath(c.req.path)) {
      await next();
      return;
    }
    
    try {
      // Get authorization header
      const authHeader = c.req.header('Authorization');
      
      if (!authHeader) {
        return this.unauthorizedResponse(c, 'Missing authorization header');
      }
      
      // Extract and verify token
      const token = authHeader.substring(7);
      const payload = await JWTService.verifyToken(token);
      
      // Create user context
      const userContext: UserContext = {
        id: payload.sub,
        role: payload.role,
        permissions: payload.permissions || ['quiz_participation'],
        sessionId: payload.sessionId,
        participantId: parseInt(payload.sub)
      };
      
      // Store user info in context
      c.set('user', userContext);
      c.set('jwt', payload);
      
      // Check if token is expiring soon
      const expiresIn = (payload.exp || 0) - Math.floor(Date.now() / 1000);
      if (expiresIn < 3600) { // Less than 1 hour
        c.header('X-Token-Refresh-Needed', 'true');
        c.header('X-Token-Expires-In', String(payload.exp! - Math.floor(Date.now() / 1000)));
      }
      
      // Log successful authentication
      Logger.info('User authenticated', {
        userId: payload.sub,
        role: payload.role,
        sessionId: payload.sessionId,
        path: c.req.path,
        ip: this.getClientIP(c),
        userAgent: this.getUserAgent(c)
      });
      
      await next();
      
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AuthenticationError') {
        // Log authentication failure
        Logger.warn('Authentication failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          code: error instanceof Error && 'code' in error ? (error as any).code : 'UNKNOWN_ERROR',
          path: c.req.path,
          ip: this.getClientIP(c),
          userAgent: this.getUserAgent(c)
        });
        
        return this.unauthorizedResponse(c, error instanceof Error ? error.message : 'Unknown error', 'AUTH_ERROR');
      }
      
      Logger.error('Authentication middleware error', error as Error);
      return this.unauthorizedResponse(c, 'Authentication failed');
    }
  }
  
  private isPublicPath(path: string): boolean {
    return AuthenticationMiddleware.PUBLIC_PATHS.some(publicPath => {
      if (publicPath.endsWith('*')) {
        const prefix = publicPath.slice(0, -1);
        return path.startsWith(prefix);
      }
      return path === publicPath;
    });
  }
  
  private unauthorizedResponse(
    c: Context,
    message: string,
    code: string = 'UNAUTHORIZED'
  ): Response {
    return c.json({
      success: false,
      error: {
        code,
        message
      },
      timestamp: new Date().toISOString()
    }, 401);
  }
}

/**
 * Authorization middleware factory
 * Creates middleware for role and permission-based access control
 */
export class AuthorizationMiddleware {
  /**
   * Require a specific role or higher
   */
  static requireRole(requiredRole: 'user' | 'admin' | 'super_admin') {
    return async (c: Context, next: Next): Promise<Response | void> => {
      const user = c.get('user') as UserContext | undefined;
      
      if (!user) {
        return c.json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          },
          timestamp: new Date().toISOString()
        }, 401);
      }
      
      if (!this.hasRequiredRole(user.role, requiredRole)) {
        Logger.warn('Insufficient role for access', {
          userId: user.id,
          userRole: user.role,
          requiredRole: requiredRole,
          path: c.req.path,
          method: c.req.method
        });
        
        return c.json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions. Required role: ' + requiredRole
          },
          timestamp: new Date().toISOString()
        }, 403);
      }
      
      await next();
    };
  }
  
  /**
   * Require specific permission(s)
   */
  static requirePermission(requiredPermission: Permission | Permission[]) {
    return async (c: Context, next: Next): Promise<Response | void> => {
      const user = c.get('user') as UserContext | undefined;
      
      if (!user) {
        return c.json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          },
          timestamp: new Date().toISOString()
        }, 401);
      }
      
      const permissions = Array.isArray(requiredPermission) 
        ? requiredPermission 
        : [requiredPermission];
      
      const hasPermission = permissions.length === 1
        ? PermissionManager.hasPermission(user.permissions, permissions[0]!)
        : PermissionManager.hasAnyPermission(user.permissions, permissions);
      
      if (!hasPermission) {
        Logger.warn('Insufficient permissions for access', {
          userId: user.id,
          userPermissions: user.permissions,
          requiredPermissions: permissions,
          path: c.req.path,
          method: c.req.method
        });
        
        return c.json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions for this operation'
          },
          timestamp: new Date().toISOString()
        }, 403);
      }
      
      await next();
    };
  }
  
  /**
   * Require any of the specified permissions
   */
  static requireAnyPermission(requiredPermissions: Permission[]) {
    return async (c: Context, next: Next): Promise<Response | void> => {
      const user = c.get('user') as UserContext | undefined;
      
      if (!user) {
        return c.json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          },
          timestamp: new Date().toISOString()
        }, 401);
      }
      
      if (!PermissionManager.hasAnyPermission(user.permissions, requiredPermissions)) {
        Logger.warn('Insufficient permissions for access', {
          userId: user.id,
          userPermissions: user.permissions,
          requiredPermissionsAny: requiredPermissions,
          path: c.req.path,
          method: c.req.method
        });
        
        return c.json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions for this operation'
          },
          timestamp: new Date().toISOString()
        }, 403);
      }
      
      await next();
    };
  }
  
  /**
   * Check role hierarchy
   */
  private static hasRequiredRole(
    userRole: string,
    requiredRole: string
  ): boolean {
    const roleHierarchy = {
      'user': 0,
      'admin': 1,
      'super_admin': 2
    };
    
    const userLevel = roleHierarchy[userRole as keyof typeof roleHierarchy];
    const requiredLevel = roleHierarchy[requiredRole as keyof typeof roleHierarchy];
    
    if (userLevel === undefined || requiredLevel === undefined) {
      return false;
    }
    
    return userLevel >= requiredLevel;
  }
}

/**
 * Session validation middleware
 * Ensures user can only access their own resources
 */
export class SessionValidationMiddleware {
  static validateSessionOwnership() {
    return async (c: Context, next: Next): Promise<Response | void> => {
      const user = c.get('user') as UserContext | undefined;
      
      if (!user) {
        return c.json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          },
          timestamp: new Date().toISOString()
        }, 401);
      }
      
      // Get session ID from various sources
      const sessionIdFromPath = c.req.param('sessionId');
      const sessionIdFromBody = c.get('validatedBody')?.sessionId;
      const sessionIdFromQuery = c.req.query('sessionId');
      
      const requestSessionId = sessionIdFromPath || sessionIdFromBody || sessionIdFromQuery;
      
      // Admins can access any session
      if (user.role === 'admin' || user.role === 'super_admin') {
        await next();
        return;
      }
      
      // Check if user owns the session
      if (requestSessionId && requestSessionId !== user.sessionId) {
        Logger.warn('Session ownership validation failed', {
          userId: user.id,
          userSessionId: user.sessionId,
          requestedSessionId: requestSessionId,
          path: c.req.path
        });
        
        return c.json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You can only access your own session data'
          },
          timestamp: new Date().toISOString()
        }, 403);
      }
      
      await next();
    };
  }
  
  static validateParticipantOwnership() {
    return async (c: Context, next: Next): Promise<Response | void> => {
      const user = c.get('user') as UserContext | undefined;
      
      if (!user) {
        return c.json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          },
          timestamp: new Date().toISOString()
        }, 401);
      }
      
      // Get participant ID from various sources
      const participantIdFromPath = c.req.param('participantId');
      const participantIdFromBody = c.get('validatedBody')?.participantId;
      const participantIdFromQuery = c.req.query('participantId');
      
      const requestParticipantId = participantIdFromPath || participantIdFromBody || participantIdFromQuery;
      
      // Admins can access any participant
      if (user.role === 'admin' || user.role === 'super_admin') {
        await next();
        return;
      }
      
      // Check if user is the participant
      if (requestParticipantId && 
          parseInt(requestParticipantId) !== user.participantId) {
        Logger.warn('Participant ownership validation failed', {
          userId: user.id,
          userParticipantId: user.participantId,
          requestedParticipantId: requestParticipantId,
          path: c.req.path
        });
        
        return c.json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You can only access your own data'
          },
          timestamp: new Date().toISOString()
        }, 403);
      }
      
      await next();
    };
  }
}

/**
 * API key authentication middleware (for specific endpoints)
 */
export class APIKeyMiddleware extends BaseMiddleware {
  private static readonly API_KEY_HEADER = 'X-API-Key';
  
  async handle(c: Context, next: Next): Promise<Response | void> {
    const apiKey = c.req.header(APIKeyMiddleware.API_KEY_HEADER);
    
    if (!apiKey) {
      return c.json({
        success: false,
        error: {
          code: 'MISSING_API_KEY',
          message: 'API key required'
        },
        timestamp: new Date().toISOString()
      }, 401);
    }
    
    // Validate API key (in production, check against database)
    const validApiKey = process.env['INTERNAL_API_KEY'];
    
    if (apiKey !== validApiKey) {
      Logger.warn('Invalid API key attempt', {
        path: c.req.path,
        ip: this.getClientIP(c)
      });
      
      return c.json({
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid API key'
        },
        timestamp: new Date().toISOString()
      }, 401);
    }
    
    // Set system context
    c.set('user', {
      id: 'system',
      role: 'super_admin',
      permissions: Object.values(Permission)
    });
    
    await next();
  }
}

/**
 * Export singleton instances
 */
export const authenticationMiddleware = new AuthenticationMiddleware().handle.bind(new AuthenticationMiddleware());
export const apiKeyMiddleware = new APIKeyMiddleware().handle.bind(new APIKeyMiddleware());

import type { Next } from 'hono'
import { JWTService } from '@/services/JWTService'
import { ErrorCode, AppError } from '@/types/errors'
import type { AppContext, UserContext } from '@/types/api'
import { createLogger } from '@/config/environment'

const logger = createLogger('auth-middleware')

export class AuthMiddleware {

  // Required authentication - throws error if no user
  authenticate() {
    return async (c: AppContext, next: Next) => {
      try {
        const authHeader = c.req.header('Authorization')
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          throw new AppError(
            ErrorCode.UNAUTHORIZED,
            'Missing or invalid authorization header',
            401
          )
        }

        const token = authHeader.substring(7)
        const payload = await JWTService.verifyToken(token)
        
        const user: UserContext = {
          id: payload.sub!,
          name: payload.name || 'Unknown',
          email: payload.email,
          role: payload.role || 'user',
          permissions: payload.permissions || [],
          sessionId: payload.sessionId
        }
        
        c.set('user', user)
        await next()
      } catch (error) {
        logger.error('Authentication failed:', error)
        
        if (error instanceof AppError) {
          return c.json({ 
            success: false, 
            error: {
              code: error.code,
              message: error.message
            },
            timestamp: new Date().toISOString()
          }, error.statusCode as any)
        }
        
        return c.json({ 
          success: false, 
          error: {
            code: ErrorCode.UNAUTHORIZED,
            message: 'Authentication failed'
          },
          timestamp: new Date().toISOString()
        }, 401)
      }
      return
    }
  }

  // Optional authentication - doesn't fail if no token
  optionalAuth() {
    return async (c: AppContext, next: Next) => {
      try {
        const authHeader = c.req.header('Authorization')
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7)
          const payload = await JWTService.verifyToken(token)
          
          const user: UserContext = {
            id: payload.sub!,
            name: payload.name || 'Unknown',
            email: payload.email,
            role: payload.role || 'user',
            permissions: payload.permissions || [],
            sessionId: payload.sessionId
          }

          c.set('user', user)
        }

        await next()
      } catch (error) {
        logger.warn('Optional authentication failed:', error)
        // Continue without user context
        await next()
      }
    }
  }

  // Role-based authorization
  requireRole(requiredRole: 'user' | 'admin' | 'super_admin') {
    return async (c: AppContext, next: Next) => {
      const user = c.get('user')
      
      if (!user) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          'Authentication required',
          401
        )
      }

      const roleHierarchy = { user: 0, admin: 1, super_admin: 2 }
      const userLevel = roleHierarchy[user.role]
      const requiredLevel = roleHierarchy[requiredRole]

      if (userLevel < requiredLevel) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Insufficient permissions',
          403
        )
      }

      await next()
    }
  }
}

// Helper function to get authenticated user (throws if not found)
export function getAuthenticatedUser(c: AppContext): UserContext {
  const user = c.get('user')
  if (!user) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED,
      'User not authenticated',
      401
    )
  }
  return user
}

// Helper function to get optional user (returns undefined if not found)
export function getOptionalUser(c: AppContext): UserContext | undefined {
  return c.get('user')
}

import jwt from 'jsonwebtoken'
import { env } from '@/config/environment'
import { createLogger } from '@/config/environment'

const logger = createLogger('jwt-service')

export interface JWTPayload {
  sub: string
  name: string
  email?: string
  role: 'user' | 'admin' | 'super_admin'
  permissions: string[]
  sessionId?: string
  iat?: number
  exp?: number
}

export class JWTService {
  // STATIC METHOD'A ÇEVİR
  static async generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
    try {
      const now = Math.floor(Date.now() / 1000)
      const fullPayload: JWTPayload = {
        ...payload,
        iat: now,
        exp: now + (24 * 60 * 60) // 24 hours
      }

      return jwt.sign(fullPayload, env.JWT_SECRET, {
        algorithm: 'HS256'
      })
    } catch (error) {
      logger.error('Token generation failed:', error)
      throw new Error('Failed to generate JWT token')
    }
  }

  // STATIC METHOD'A ÇEVİR
  static async verifyToken(token: string): Promise<JWTPayload> {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256']
      }) as JWTPayload

      return decoded
    } catch (error) {
      logger.error('Token verification failed:', error)
      throw new Error('Invalid or expired token')
    }
  }

  // STATIC METHOD'A ÇEVİR
  static async refreshToken(oldToken: string): Promise<string> {
    try {
      const payload = await this.verifyToken(oldToken)
      
      // Remove timing fields for refresh
      const { iat, exp, ...refreshPayload } = payload
      
      return await this.generateToken(refreshPayload)
    } catch (error) {
      logger.error('Token refresh failed:', error)
      throw new Error('Failed to refresh token')
    }
  }
}

// Permission management (keep as static)
export class PermissionManager {
  static hasPermission(userPermissions: string[], requiredPermission: string): boolean {
    return userPermissions.includes(requiredPermission) || userPermissions.includes('*')
  }

  static hasAnyPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
    return requiredPermissions.some(permission => this.hasPermission(userPermissions, permission))
  }
}

export enum Permission {
  QUIZ_PARTICIPATION = 'quiz_participation',
  ADMIN_ACCESS = 'admin_access',
  USER_MANAGEMENT = 'user_management',
  QUESTION_MANAGEMENT = 'question_management',
  ANALYTICS_VIEW = 'analytics_view',
  SYSTEM_CONFIG = 'system_config'
}
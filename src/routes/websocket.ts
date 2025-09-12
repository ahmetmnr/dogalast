import { Hono } from 'hono'
import { JWTService } from '@/services/JWTService'
import { createLogger } from '@/config/environment'
import type { ContextWithAuth } from '@/types/auth'
import type { UserContext } from '@/types/api'

const logger = createLogger('websocket')

export const websocketRoutes = new Hono<{ Variables: ContextWithAuth }>()

// WebSocket upgrade endpoint
websocketRoutes.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('upgrade')
  
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.json({
      success: false,
      error: {
        code: 'WEBSOCKET_UPGRADE_REQUIRED',
        message: 'WebSocket upgrade required'
      }
    }, 426)
  }

  // Get token from query parameter (WebSocket doesn't support custom headers)
  const token = c.req.query('token')
  if (!token) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    }, 401)
  }

  // Verify token and upgrade to WebSocket
  try {
    const payload = await JWTService.verifyToken(token)
    const user: UserContext = {
      id: payload.sub!,
      name: payload.name || 'Unknown',
      email: payload.email,
      role: payload.role || 'user',
      permissions: payload.permissions || [],
      sessionId: payload.sessionId
    }
    
    logger.info(`WebSocket connection attempt from user ${user.id}`)

    // For WebSocket upgrade, we need to handle it at server level
    // Return user data for WebSocket context
    if (c.req.header('upgrade') === 'websocket') {
      // Store user data in response headers for Bun WebSocket handler
      return new Response(null, {
        status: 101,
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'X-User-Id': user.id,
          'X-User-Name': user.name || '',
          'X-Session-Id': user.sessionId || ''
        }
      });
    }
    
  } catch (error) {
    logger.error('WebSocket authentication failed:', error)
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid token'
      }
    }, 401)
  }

  return c.json({
    success: false,
    error: {
      code: 'WEBSOCKET_UPGRADE_FAILED',
      message: 'WebSocket upgrade failed'
    }
  }, 426)
})

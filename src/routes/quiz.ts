import { Hono } from 'hono'

// Services
import { SecureToolHandler } from '@/services/SecureToolHandler'
import { ScoringService } from '@/services/ScoringService'

// Middleware
import { ValidationMiddleware, schemas, querySchemas } from '@/middleware/validation'
import { AuthMiddleware, getAuthenticatedUser } from '@/middleware/auth'

// Types
import type { AppContext, ToolDispatchRequest } from '@/types/api'
import { ErrorCode, AppError } from '@/types/errors'

// Utils
import { createLogger } from '@/config/environment'

const logger = createLogger('quiz-routes')

// Create router
const router = new Hono<{ Variables: any }>()

// Tool dispatch endpoint
router.post(
  '/tools/dispatch',
  new AuthMiddleware().authenticate(),
  ValidationMiddleware.validateBody(schemas.toolDispatch),
  async (c: AppContext) => {
    try {
      const user = getAuthenticatedUser(c)
      const validatedBody = c.get('validatedBody') as ToolDispatchRequest
      const db = c.get('db')

      const toolHandler = new SecureToolHandler(db, user)
      
      const result = await toolHandler.executeTool(
        validatedBody.tool,
        validatedBody.args,
        validatedBody.sessionId
      )

      return c.json({
        success: true,
        data: result,
        timing: {
          serverTimestamp: Date.now(),
          processingTime: 0 // Will be calculated by middleware
        },
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      logger.error('Tool dispatch failed:', error)
      
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
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: 'Tool execution failed'
        },
        timestamp: new Date().toISOString()
      }, 500)
    }
  }
)

// Leaderboard endpoint
router.get(
  '/leaderboard',
  ValidationMiddleware.validateQuery(querySchemas.leaderboard),
  async (c: AppContext) => {
    try {
      const db = c.get('db')
      const validatedQuery = c.get('validatedQuery') as {
        limit: number
        offset: number
        period: 'all' | 'today' | 'week' | 'month'
      }

      const scoringService = new ScoringService(db)
      const fullLeaderboard = await scoringService.getLeaderboard(validatedQuery.limit + validatedQuery.offset)
      
      // Apply pagination
      const paginatedResults = fullLeaderboard.slice(validatedQuery.offset, validatedQuery.offset + validatedQuery.limit)

      return c.json({
        success: true,
        data: {
          entries: paginatedResults,
          pagination: {
            total: fullLeaderboard.length,
            limit: validatedQuery.limit,
            offset: validatedQuery.offset,
            hasMore: validatedQuery.offset + validatedQuery.limit < fullLeaderboard.length
          }
        },
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      logger.error('Leaderboard fetch failed:', error)
      
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
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: 'Leaderboard fetch failed'
        },
        timestamp: new Date().toISOString()
      }, 500)
    }
  }
)

// Export router
// Realtime token endpoint
router.get('/realtime/token', async (c: AppContext) => {
  try {
    const sessionId = c.req.query('sessionId')
    if (!sessionId) {
      return c.json({ success: false, error: { code: 'MISSING_SESSION_ID', message: 'Session ID required' } }, 400)
    }
    
    // Call OpenAI API to create ephemeral token
    const openaiApiKey = process.env['OPENAI_API_KEY']
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured')
    }

    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2025-06-03',
        voice: 'alloy'
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('OpenAI API error:', error)
      throw new Error('Failed to create ephemeral token')
    }

    const data = await response.json() as any
    console.log('OpenAI API response:', JSON.stringify(data, null, 2))
    
    return c.json({
      success: true,
      data: {
        token: data.client_secret?.value || data.token || 'fallback-token',
        sessionId,
        expiresIn: data.client_secret?.expires_at ? (data.client_secret.expires_at - Math.floor(Date.now() / 1000)) : 3600
      }
    })
  } catch (error) {
    console.error('Token generation error:', error)
    return c.json({ 
      success: false, 
      error: { 
        code: 'TOKEN_ERROR', 
        message: error instanceof Error ? error.message : 'Failed to generate token' 
      } 
    }, 500)
  }
})

export { router as quizRoutes }
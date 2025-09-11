import { Hono } from 'hono'

// Services
import { SecureToolHandler } from '@/services/SecureToolHandler'
import { ScoringService } from '@/services/ScoringService'

// Middleware
import { ValidationMiddleware, schemas, querySchemas } from '@/middleware/validation'
import { getAuthenticatedUser } from '@/middleware/auth'

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
export { router as quizRoutes }
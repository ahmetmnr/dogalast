import { Hono } from 'hono'

// Services
import { ScoringService } from '@/services/ScoringService'

// Middleware
import { ValidationMiddleware, querySchemas } from '@/middleware/validation'

// Types
import type { AppContext } from '@/types/api'
import { AppError, ErrorCode } from '@/types/errors'

// Utils
import { createLogger } from '@/config/environment'

const logger = createLogger('leaderboard-routes')

const router = new Hono<{ Variables: any }>()

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
      const fullLeaderboard = await scoringService.getLeaderboard(
        validatedQuery.limit + validatedQuery.offset
      )

      const paginatedResults = fullLeaderboard.slice(
        validatedQuery.offset,
        validatedQuery.offset + validatedQuery.limit
      )

      return c.json({
        success: true,
        data: {
          entries: paginatedResults,
          pagination: {
            total: fullLeaderboard.length,
            limit: validatedQuery.limit,
            offset: validatedQuery.offset,
            hasMore:
              validatedQuery.offset + validatedQuery.limit < fullLeaderboard.length
          }
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Leaderboard fetch failed:', error)

      if (error instanceof AppError) {
        return c.json(
          {
            success: false,
            error: {
              code: error.code,
              message: error.message
            },
            timestamp: new Date().toISOString()
          },
          error.statusCode as any
        )
      }

      return c.json(
        {
          success: false,
          error: {
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: 'Leaderboard fetch failed'
          },
          timestamp: new Date().toISOString()
        },
        500
      )
    }
  }
)

export { router as leaderboardRoutes }

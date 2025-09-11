import { Hono } from 'hono'
import { or, like } from 'drizzle-orm'

// Database schema
import { participants } from '@/db/schema'

// Middleware
import { ValidationMiddleware, querySchemas } from '@/middleware/validation'
import { getAuthenticatedUser } from '@/middleware/auth'

// Types
import type { AppContext } from '@/types/api'
import { ErrorCode, AppError } from '@/types/errors'

// Utils
import { createLogger } from '@/config/environment'

const logger = createLogger('admin-routes')

// Create router
const router = new Hono<{ Variables: any }>()

// Get participants endpoint
router.get(
  '/participants',
  ValidationMiddleware.validateQuery(querySchemas.pagination),
  async (c: AppContext) => {
    try {
      const user = getAuthenticatedUser(c)
      const db = c.get('db')
      
      // Check admin permissions
      if (user.role !== 'admin' && user.role !== 'super_admin') {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Admin access required',
          403
        )
      }

      const query = c.get('validatedQuery') as {
        page: number
        pageSize: number
        search?: string
      }

      let participantsQuery = db.select().from(participants)
      
      if (query.search) {
        const searchConditions = [
          like(participants.name, `%${query.search}%`)
        ];
        
        if (participants.email) {
          searchConditions.push(like(participants.email, `%${query.search}%`));
        }
        
        participantsQuery = participantsQuery.where(
          or(...searchConditions)
        ) as typeof participantsQuery
      }

      const results = await participantsQuery
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)

      return c.json({
        success: true,
        data: {
          participants: results,
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            total: results.length
          }
        },
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      logger.error('Get participants failed:', error)
      
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
          message: 'Failed to get participants'
        },
        timestamp: new Date().toISOString()
      }, 500)
    }
  }
)

// Export router
export { router as adminRoutes }
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'

// Environment and config
import { env, createLogger, isDevelopment } from '@/config/environment'

// Database connection
import { createDatabaseConnection } from '@/db/connection'

// Middleware
import { performanceMiddleware } from '@/utils/dev-tools'

// Routes
import { authRoutes } from '@/routes/auth'
import { quizRoutes } from '@/routes/quiz'
import { adminRoutes } from '@/routes/admin'

// Types
import type { ContextVariables } from '@/types/api'

const appLogger = createLogger('app')

// Create Hono app with proper typing
const app = new Hono<{ Variables: ContextVariables }>()

// Global middleware
app.use('*', logger())
app.use('*', prettyJSON())
app.use('*', secureHeaders())

if (isDevelopment) {
  app.use('*', performanceMiddleware())
}

// CORS configuration
app.use('*', cors({
  origin: isDevelopment ? ['http://localhost:3000', 'http://localhost:8787'] : ['https://quiz.sifiratiketkinligi.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}))

// Database middleware - inject DB into context
app.use('*', async (c, next) => {
  try {
    const db = createDatabaseConnection(c.env)
    c.set('db', db)
    await next()
  } catch (error) {
    appLogger.error('Database connection failed:', error as Error)
    return c.json({
      success: false,
      error: {
        code: 'DATABASE_CONNECTION_FAILED',
        message: 'Database connection failed'
      },
      timestamp: new Date().toISOString()
    }, 500)
  }
  return
})

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      version: '1.0.0'
    }
  })
})

// API Routes
app.route('/api/auth', authRoutes)
app.route('/api/quiz', quizRoutes)
app.route('/api/admin', adminRoutes)

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found'
    },
    timestamp: new Date().toISOString()
  }, 404)
})

// Global error handler
app.onError((error, c) => {
  appLogger.error('Unhandled error:', error)
  
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isDevelopment ? error.message : 'Internal server error'
    },
    timestamp: new Date().toISOString()
  }, 500)
})

appLogger.info('Zero Waste Quiz application started successfully')

export default app
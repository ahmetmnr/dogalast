import { Context } from 'hono'
import { env, createLogger } from '@/config/environment'

const logger = createLogger('dev-tools')

export interface DevTools {
  logRequest: (c: Context) => void
  logError: (error: Error, context?: any) => void
  logPerformance: (label: string, duration: number) => void
  enableHotReload: () => void
  measureTime: <T>(label: string, fn: () => Promise<T>) => Promise<T>
}

export function createDevTools(): DevTools {
  const isDev = env.NODE_ENV === 'development'
  
  return {
    logRequest: (c: Context) => {
      if (!isDev) return
      
      const method = c.req.method
      const url = c.req.url
      const timestamp = new Date().toISOString()
      const userAgent = c.req.header('user-agent') || 'unknown'
      
      logger.debug(`${method} ${url}`, {
        timestamp,
        userAgent: userAgent.substring(0, 50),
        headers: Object.fromEntries(c.req.raw.headers.entries())
      })
    },
    
    logError: (error: Error, context?: any) => {
      if (!isDev) return
      
      logger.error('Request error:', {
        message: error.message,
        stack: error.stack,
        context
      })
    },
    
    logPerformance: (label: string, duration: number) => {
      if (!isDev) return
      
      const color = duration > 1000 ? '🔴' : duration > 500 ? '🟡' : '🟢'
      logger.debug(`${color} [Performance] ${label}: ${duration.toFixed(2)}ms`)
    },
    
    enableHotReload: () => {
      if (!isDev) return
      
      logger.info('🔥 Hot reload enabled')
      logger.info('📝 Watching for file changes...')
      
      if (typeof Bun !== 'undefined') {
        logger.info('⚡ Bun hot reload active')
      }
    },
    
    measureTime: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const start = performance.now()
      try {
        const result = await fn()
        const duration = performance.now() - start
        if (isDev) {
          logger.debug(`⏱️ ${label}: ${duration.toFixed(2)}ms`)
        }
        return result
      } catch (error) {
        const duration = performance.now() - start
        if (isDev) {
          logger.error(`❌ ${label} failed after ${duration.toFixed(2)}ms:`, error)
        }
        throw error
      }
    }
  }
}

// Performance middleware for Hono
export function performanceMiddleware() {
  const devTools = createDevTools()
  
  return async (c: Context, next: () => Promise<void>) => {
    const start = performance.now()
    
    // Log incoming request
    devTools.logRequest(c)
    
    try {
      await next()
      
      const duration = performance.now() - start
      devTools.logPerformance(`${c.req.method} ${c.req.path}`, duration)
      
      // Add performance header in development
      if (env.NODE_ENV === 'development') {
        c.header('X-Response-Time', `${duration.toFixed(2)}ms`)
      }
      
    } catch (error) {
      const duration = performance.now() - start
      devTools.logError(error as Error, {
        method: c.req.method,
        path: c.req.path,
        duration: `${duration.toFixed(2)}ms`
      })
      throw error
    }
  }
}

// Memory usage monitoring
export function logMemoryUsage() {
  if (env.NODE_ENV !== 'development') return
  
  const usage = process.memoryUsage()
  logger.debug('Memory usage:', {
    rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
    external: `${Math.round(usage.external / 1024 / 1024)}MB`
  })
}

// Start memory monitoring in development
if (env.NODE_ENV === 'development') {
  setInterval(logMemoryUsage, 60000) // Every minute
}

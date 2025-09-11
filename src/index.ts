/**
 * Zero Waste Quiz - Main Server Entry Point
 * Hono + Cloudflare Workers + TypeScript
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

// Type imports
import type { ApiResponse } from '@/types/api';
import type { D1Database } from '@cloudflare/workers-types';

// Middleware imports
import { databaseMiddleware } from '@/db/connection';
import { securityMiddleware } from '@/middleware/SecurityMiddleware';
import { rateLimitMiddleware } from '@/middleware/RateLimitMiddleware';
import { authenticationMiddleware } from '@/middleware/RoleMiddleware';

// Route imports
import { setupAuthRoutes } from '@/routes/auth';
import { setupQuizRoutes } from '@/routes/quiz';
import { setupAdminRoutes } from '@/routes/admin';

// Utils
import { Environment } from '@/utils/environment';
import { globalErrorHandler } from '@/utils/ErrorHandler';

// Environment interface
export interface Env {
  // Database bindings
  DB: D1Database;
  
  // Durable Object bindings  
  LEADERBOARD_BROADCASTER: DurableObjectNamespace;
  SESSION_MANAGER: DurableObjectNamespace;
  
  // API Keys (secrets)
  OPENAI_API_KEY: string;
  JWT_SECRET: string;
  ADMIN_JWT_SECRET: string;
  
  // CORS configuration
  CORS_ORIGINS: string;
  
  // Privacy and GDPR
  AUDIO_RETENTION_DAYS: string;
  DATA_RETENTION_DAYS: string;
  TRANSCRIPT_RETENTION_DAYS: string;
  GDPR_COMPLIANCE_MODE: string;
  
  // Performance settings
  RATE_LIMIT_REQUESTS_PER_MINUTE: string;
  SESSION_TIMEOUT_SECONDS: string;
  CACHE_TTL_SECONDS: string;
  
  // Feature flags
  VAD_CALIBRATION_ENABLED: string;
  TOKEN_REFRESH_THRESHOLD: string;
  
  // Environment
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
}

// Create Hono app with typed bindings
const app = new Hono<{ Bindings: Env }>();

// Set global error handler
app.onError(globalErrorHandler);

// Initialize environment on first request
app.use('*', async (c, next) => {
  Environment.init(c.env);
  await next();
});

// Global middleware stack (order matters!)
// 1. Pretty JSON for development
app.use('*', prettyJSON());

// 2. Request logging
app.use('*', logger());

// 3. Request ID generation
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  await next();
});

// 4. Security headers (OWASP)
app.use('*', securityMiddleware);

// 5. Rate limiting
app.use('*', rateLimitMiddleware);

// 6. CORS handling
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return '*';
      const allowedOrigins = Environment.getAllowedOrigins();
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return origin;
      }
      return Environment.isDevelopment() ? '*' : null;
    },
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['X-Request-ID', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Token-Refresh-Needed'],
    credentials: true,
    maxAge: 3600,
  });
  
  return corsMiddleware(c, next);
});

// 7. Database middleware
app.use('*', databaseMiddleware());

// 8. Authentication middleware (skip for public routes)
app.use('*', authenticationMiddleware);

// Health check endpoint
app.get('/health', (c) => {
  const env = c.env.ENVIRONMENT || 'development';
  
  const response: ApiResponse<{
    status: string;
    timestamp: string;
    version: string;
    environment: string;
    services: {
      database: string;
      openai: string;
    };
  }> = {
    success: true,
    timestamp: new Date().toISOString(),
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: env,
      services: {
        database: c.env.DB ? 'connected' : 'disconnected',
        openai: c.env.OPENAI_API_KEY ? 'available' : 'unavailable',
      },
    },
  };
  
  return c.json(response);
});

// Setup API routes
setupAuthRoutes(app);
setupQuizRoutes(app);
setupAdminRoutes(app);

// API status endpoint
app.get('/api/status', (c) => {
  const response: ApiResponse<{ message: string }> = {
    success: true,
    timestamp: new Date().toISOString(),
    data: {
      message: 'Zero Waste Quiz API is running',
      version: '1.0.0',
      environment: Environment.getEnvironment(),
    },
  };
  return c.json(response);
});

// 404 handler
app.notFound((c) => {
  const requestId = c.get('requestId');
  const response: ApiResponse = {
    success: false,
    timestamp: new Date().toISOString(),
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint bulunamadı',
      requestId,
      details: {
        path: c.req.path,
        method: c.req.method,
      },
    },
  };
  
  return c.json(response, 404);
});

// Note: Global error handler is set at the top using app.onError(globalErrorHandler)

// Export for Cloudflare Workers
export default {
  fetch: app.fetch,
};

// Export for testing
export { app };

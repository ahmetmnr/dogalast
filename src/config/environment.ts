import { z } from 'zod'

const envSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  
  // Database
  DATABASE_URL: z.string().optional(),
  
  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OpenAI API key is required'),
  
  // JWT
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  
  // Admin
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD_HASH: z.string().min(1, 'Admin password hash is required'),
  
  // Cloudflare
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  
  // Rate Limiting
  RATE_LIMIT_GLOBAL: z.coerce.number().default(1000),
  RATE_LIMIT_REGISTRATION: z.coerce.number().default(5),
  RATE_LIMIT_TOOLS: z.coerce.number().default(60),
  RATE_LIMIT_ADMIN: z.coerce.number().default(30),
  
  // Privacy & KVKK
  AUDIO_RETENTION_DAYS: z.coerce.number().default(0),
  DATA_RETENTION_DAYS: z.coerce.number().default(365),
  PRIVACY_CONTACT_EMAIL: z.string().email().default('privacy@example.com'),
  
  // Development
  ENABLE_CORS: z.coerce.boolean().default(true),
  ENABLE_LOGGING: z.coerce.boolean().default(true),
  ENABLE_ANALYTICS: z.coerce.boolean().default(false),
  
  // Performance
  MAX_REQUEST_SIZE: z.coerce.number().default(10485760), // 10MB
  REQUEST_TIMEOUT: z.coerce.number().default(30000), // 30s
  
  // Security
  BCRYPT_ROUNDS: z.coerce.number().default(12),
  SESSION_TIMEOUT: z.coerce.number().default(86400000), // 24h in ms
  
  // OpenAI Realtime
  OPENAI_REALTIME_MODEL: z.string().default('gpt-4o-realtime-preview-2024-10-01'),
  OPENAI_VOICE: z.string().default('alloy'),
  
  // WebSocket
  WS_HEARTBEAT_INTERVAL: z.coerce.number().default(30000), // 30s
  WS_CONNECTION_TIMEOUT: z.coerce.number().default(5000), // 5s
})

export type Environment = z.infer<typeof envSchema>

export function validateEnvironment(env: Record<string, string | undefined>): Environment {
  try {
    return envSchema.parse(env)
  } catch (error) {
    console.error('❌ Environment validation failed:')
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`)
      })
    }
    process.exit(1)
  }
}

// Load .env.local file if exists (for local development)
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config({ path: '.env.local' });
  } catch (e) {
    // dotenv not available, continue without it
  }
}

// Global environment instance
export const env = validateEnvironment(process.env)

// Environment helpers
export const isDevelopment = env.NODE_ENV === 'development'
export const isProduction = env.NODE_ENV === 'production'
export const isStaging = env.NODE_ENV === 'staging'

// Logging helper
export function createLogger(module: string) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 }
  const currentLevel = levels[env.LOG_LEVEL]
  
  return {
    debug: (message: string, ...args: any[]) => {
      if (currentLevel <= 0) console.debug(`🐛 [${module}] ${message}`, ...args)
    },
    info: (message: string, ...args: any[]) => {
      if (currentLevel <= 1) console.info(`ℹ️ [${module}] ${message}`, ...args)
    },
    warn: (message: string, ...args: any[]) => {
      if (currentLevel <= 2) console.warn(`⚠️ [${module}] ${message}`, ...args)
    },
    error: (message: string, ...args: any[]) => {
      if (currentLevel <= 3) console.error(`❌ [${module}] ${message}`, ...args)
    }
  }
}

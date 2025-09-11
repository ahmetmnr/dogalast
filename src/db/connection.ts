import { drizzle } from 'drizzle-orm/d1'
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import * as schema from './schema'

export type DatabaseInstance = ReturnType<typeof createDatabaseConnection>

export function createDatabaseConnection(env: any) {
  // For local development with Bun, use SQLite directly
  if (process.env['NODE_ENV'] === 'development' && !env.DB) {
    const dbPath = process.env['DATABASE_URL'] || './.wrangler/state/v3/d1/miniflare-D1DatabaseObject/zero-waste-quiz-dev.sqlite'
    const sqlite = new Database(dbPath)
    return drizzleSqlite(sqlite, { schema })
  }
  
  // For production/Cloudflare Workers, use D1
  if (!env.DB) {
    throw new Error('Database binding not found. Make sure D1 database is configured in wrangler.toml')
  }
  
  return drizzle(env.DB, { schema })
}

// Export schema for easy access
export { schema }
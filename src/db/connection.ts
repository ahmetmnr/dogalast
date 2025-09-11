/**
 * Database Connection Management
 * Cloudflare D1 connection with Drizzle ORM
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Context, Next } from 'hono';

import { Logger } from '@/utils/logger';
import * as schema from './schema';

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { Env } from '@/index';

/**
 * Type-safe database instance type
 */
export type DatabaseInstance = DrizzleD1Database<typeof schema>;

/**
 * Create database connection
 * @param env Cloudflare environment with D1 binding
 * @returns Database instance
 */
export function createDatabase(env: Env): DatabaseInstance {
  try {
    if (!env.DB) {
      throw new Error('D1 database binding not found in environment');
    }

    const db = drizzle(env.DB, {
      schema,
      logger: env.ENVIRONMENT === 'development',
    });

    return db;
  } catch (error) {
    Logger.error('Database connection failed', error as Error);
    throw new Error('Failed to initialize database connection');
  }
}

/**
 * Check database health
 * @param db Database instance
 * @returns True if healthy
 */
export async function checkDatabaseHealth(db: DatabaseInstance): Promise<boolean> {
  try {
    // Simple query to test connection
    const result = await db
      .select({ value: schema.systemSettings.value })
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, 'database_version'))
      .limit(1);

    return true;
  } catch (error) {
    Logger.error('Database health check failed', error as Error);
    return false;
  }
}

/**
 * Execute a database transaction
 * @param db Database instance
 * @param callback Transaction callback
 * @returns Transaction result
 */
export async function withTransaction<T>(
  db: DatabaseInstance,
  callback: (tx: DatabaseInstance) => Promise<T>
): Promise<T> {
  try {
    // D1 doesn't support traditional transactions yet
    // This is a placeholder for when it does
    return await callback(db);
  } catch (error) {
    Logger.error('Transaction failed', error as Error);
    throw error;
  }
}

/**
 * Execute batch operations
 * @param db Database instance
 * @param operations Array of database operations
 */
export async function executeBatch(
  db: DatabaseInstance,
  operations: Array<() => Promise<any>>
): Promise<void> {
  try {
    // Execute operations sequentially for D1
    for (const operation of operations) {
      await operation();
    }
  } catch (error) {
    Logger.error('Batch execution failed', error as Error);
    throw error;
  }
}

/**
 * Database middleware for Hono
 * Adds database instance to context
 */
export function databaseMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      const db = createDatabase(c.env);
      
      // Add database to context
      c.set('db', db);
      
      // Check database health on first request
      if (c.env.ENVIRONMENT === 'development') {
        const isHealthy = await checkDatabaseHealth(db);
        if (!isHealthy) {
          Logger.warn('Database health check failed but continuing');
        }
      }
      
      await next();
    } catch (error) {
      Logger.error('Database middleware error', error as Error);
      
      return c.json({ 
        success: false,
        error: {
          code: 'DATABASE_CONNECTION_FAILED',
          message: 'Unable to connect to database',
        },
        timestamp: new Date().toISOString(),
      }, 500);
    }
  };
}

/**
 * Get database instance from context
 * @param c Hono context
 * @returns Database instance
 */
export function getDatabase(c: Context): DatabaseInstance {
  const db = c.get('db') as DatabaseInstance | undefined;
  
  if (!db) {
    throw new Error('Database not initialized in context');
  }
  
  return db;
}

/**
 * Database query helpers
 */
export const db = {
  /**
   * Get current timestamp for D1
   * @returns Current Unix timestamp
   */
  now(): number {
    return Math.floor(Date.now() / 1000);
  },

  /**
   * Convert Date to Unix timestamp
   * @param date Date object
   * @returns Unix timestamp
   */
  toTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  },

  /**
   * Convert Unix timestamp to Date
   * @param timestamp Unix timestamp
   * @returns Date object
   */
  fromTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
  },

  /**
   * Generate UUID v4
   * @returns UUID string
   */
  generateId(): string {
    // Simple UUID v4 generation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },
};

/**
 * Database error wrapper
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string = 'DATABASE_ERROR',
    public originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Handle database errors
 * @param error Original error
 * @returns Wrapped database error
 */
export function handleDatabaseError(error: unknown): DatabaseError {
  if (error instanceof Error) {
    // Check for specific D1 error patterns
    if (error.message.includes('UNIQUE constraint failed')) {
      return new DatabaseError(
        'A record with this value already exists',
        'UNIQUE_CONSTRAINT_VIOLATION',
        error
      );
    }
    
    if (error.message.includes('FOREIGN KEY constraint failed')) {
      return new DatabaseError(
        'Referenced record does not exist',
        'FOREIGN_KEY_VIOLATION',
        error
      );
    }
    
    if (error.message.includes('NOT NULL constraint failed')) {
      return new DatabaseError(
        'Required field is missing',
        'NOT_NULL_VIOLATION',
        error
      );
    }
    
    if (error.message.includes('no such table')) {
      return new DatabaseError(
        'Database schema not initialized',
        'TABLE_NOT_FOUND',
        error
      );
    }
    
    return new DatabaseError(
      'Database operation failed',
      'DATABASE_ERROR',
      error
    );
  }
  
  return new DatabaseError(
    'Unknown database error',
    'UNKNOWN_ERROR'
  );
}

/**
 * Retry database operation with exponential backoff
 * @param operation Database operation to retry
 * @param maxRetries Maximum number of retries
 * @param baseDelay Base delay in milliseconds
 * @returns Operation result
 */
export async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on constraint violations
      if (
        lastError.message.includes('UNIQUE constraint') ||
        lastError.message.includes('FOREIGN KEY constraint') ||
        lastError.message.includes('NOT NULL constraint')
      ) {
        throw handleDatabaseError(lastError);
      }
      
      // Exponential backoff
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw handleDatabaseError(lastError);
}

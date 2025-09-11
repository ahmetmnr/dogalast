/**
 * Structured Logging Utilities
 * Performance-aware logging with context tracking
 */

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Log context interface
 */
export interface LogContext {
  /** Session ID */
  sessionId?: string;
  
  /** User ID */
  userId?: number;
  
  /** Request ID */
  requestId?: string;
  
  /** IP address */
  ipAddress?: string;
  
  /** User agent */
  userAgent?: string;
  
  /** Additional context */
  [key: string]: any;
}

/**
 * Log entry structure
 */
interface LogEntry {
  /** Log level */
  level: string;
  
  /** Log message */
  message: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** Context data */
  context?: LogContext;
  
  /** Error details */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  
  /** Performance data */
  performance?: {
    duration?: number;
    memory?: number;
  };
}

/**
 * Logger configuration
 */
interface LoggerConfig {
  /** Minimum log level */
  level: LogLevel;
  
  /** Enable console output */
  console: boolean;
  
  /** Enable structured JSON output */
  json: boolean;
  
  /** Mask sensitive data */
  maskSensitive: boolean;
  
  /** Environment name */
  environment: string;
}

/**
 * Logger class for structured logging
 */
export class Logger {
  private static config: LoggerConfig = {
    level: LogLevel.INFO,
    console: true,
    json: true,
    maskSensitive: true,
    environment: 'development',
  };

  /**
   * Initialize logger configuration
   * @param config Logger configuration
   */
  static init(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set log level from environment
   * @param levelStr Log level string
   */
  static setLevel(levelStr: string): void {
    const levels: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
    };
    
    const level = levels[levelStr.toLowerCase()];
    if (level !== undefined) {
      this.config.level = level;
    }
  }

  /**
   * Debug level logging
   * @param message Log message
   * @param context Additional context
   */
  static debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Info level logging
   * @param message Log message
   * @param context Additional context
   */
  static info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Warning level logging
   * @param message Log message
   * @param context Additional context
   */
  static warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Error level logging
   * @param message Log message
   * @param error Error object
   * @param context Additional context
   */
  static error(message: string, error?: Error, context?: LogContext): void {
    const errorDetails = error ? {
      name: error.name,
      message: error.message,
      stack: this.config.environment === 'development' ? error.stack : undefined,
    } : undefined;
    
    this.log(LogLevel.ERROR, message, context, errorDetails);
  }

  /**
   * Audit logging for compliance
   * @param action Action performed
   * @param details Action details
   * @param context Log context
   */
  static auditLog(action: string, details: any, context: LogContext): void {
    const auditContext = {
      ...context,
      audit: true,
      action,
      details: this.maskSensitiveData(details),
      timestamp: new Date().toISOString(),
    };
    
    this.log(LogLevel.INFO, `AUDIT: ${action}`, auditContext);
  }

  /**
   * Security event logging
   * @param event Security event type
   * @param details Event details
   * @param context Log context
   */
  static securityLog(event: string, details: any, context: LogContext): void {
    const securityContext = {
      ...context,
      security: true,
      event,
      details: this.maskSensitiveData(details),
      timestamp: new Date().toISOString(),
    };
    
    this.log(LogLevel.WARN, `SECURITY: ${event}`, securityContext);
  }

  /**
   * Performance logging
   * @param operation Operation name
   * @param duration Duration in milliseconds
   * @param context Additional context
   */
  static performanceLog(operation: string, duration: number, context?: LogContext): void {
    const perfContext = {
      ...context,
      performance: true,
      operation,
      duration,
      timestamp: new Date().toISOString(),
    };
    
    const level = duration > 1000 ? LogLevel.WARN : LogLevel.INFO;
    this.log(level, `PERFORMANCE: ${operation} took ${duration}ms`, perfContext);
  }

  /**
   * Create a unique request ID
   * @returns Request ID
   */
  static createRequestId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return `${timestamp}-${random}`;
  }

  /**
   * Format log entry
   * @param level Log level
   * @param message Log message
   * @param context Log context
   * @param error Error details
   * @returns Formatted log entry
   */
  static formatLog(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: any
  ): string {
    const entry: LogEntry = {
      level: LogLevel[level],
      message,
      timestamp: new Date().toISOString(),
      context: context ? this.maskSensitiveData(context) : undefined,
      error,
    };
    
    if (this.config.json) {
      return JSON.stringify(entry);
    }
    
    // Human-readable format
    let formatted = `[${entry.timestamp}] ${entry.level}: ${entry.message}`;
    
    if (context) {
      const { requestId, sessionId, userId } = context;
      const identifiers = [];
      if (requestId) identifiers.push(`req=${requestId}`);
      if (sessionId) identifiers.push(`session=${sessionId}`);
      if (userId) identifiers.push(`user=${userId}`);
      
      if (identifiers.length > 0) {
        formatted += ` [${identifiers.join(', ')}]`;
      }
    }
    
    if (error) {
      formatted += `\n  Error: ${error.name} - ${error.message}`;
      if (error.stack && this.config.environment === 'development') {
        formatted += `\n  Stack: ${error.stack}`;
      }
    }
    
    return formatted;
  }

  /**
   * Core logging function
   * @param level Log level
   * @param message Log message
   * @param context Log context
   * @param error Error details
   */
  private static log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: any
  ): void {
    // Check if we should log this level
    if (level < this.config.level) {
      return;
    }
    
    const formatted = this.formatLog(level, message, context, error);
    
    if (this.config.console) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formatted);
          break;
        case LogLevel.INFO:
          console.info(formatted);
          break;
        case LogLevel.WARN:
          console.warn(formatted);
          break;
        case LogLevel.ERROR:
          console.error(formatted);
          break;
      }
    }
    
    // In production, you might want to send logs to a service
    if (this.config.environment === 'production') {
      this.sendToLoggingService(formatted, level);
    }
  }

  /**
   * Mask sensitive data in logs
   * @param data Data to mask
   * @returns Masked data
   */
  private static maskSensitiveData(data: any): any {
    if (!this.config.maskSensitive) {
      return data;
    }
    
    if (typeof data !== 'object' || data === null) {
      return data;
    }
    
    const sensitiveKeys = [
      'password',
      'token',
      'jwt',
      'apiKey',
      'secret',
      'creditCard',
      'ssn',
      'email',
      'phone',
      'authorization',
    ];
    
    const masked = { ...data };
    
    for (const key of Object.keys(masked)) {
      const lowerKey = key.toLowerCase();
      
      if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
        if (typeof masked[key] === 'string') {
          masked[key] = '***MASKED***';
        } else {
          masked[key] = '***MASKED***';
        }
      } else if (typeof masked[key] === 'object' && masked[key] !== null) {
        masked[key] = this.maskSensitiveData(masked[key]);
      }
    }
    
    return masked;
  }

  /**
   * Send logs to external service (placeholder)
   * @param log Log entry
   * @param level Log level
   */
  private static sendToLoggingService(log: string, level: LogLevel): void {
    // In production, implement sending to logging service
    // e.g., CloudWatch, Datadog, Sentry, etc.
    
    // For now, just store in memory (for demo)
    if (typeof globalThis !== 'undefined') {
      (globalThis as any).__logs = (globalThis as any).__logs || [];
      (globalThis as any).__logs.push({ log, level, timestamp: Date.now() });
      
      // Keep only last 1000 logs in memory
      if ((globalThis as any).__logs.length > 1000) {
        (globalThis as any).__logs = (globalThis as any).__logs.slice(-1000);
      }
    }
  }

  /**
   * Create a child logger with fixed context
   * @param context Fixed context for all logs
   * @returns Child logger instance
   */
  static createChild(context: LogContext): ChildLogger {
    return new ChildLogger(context);
  }

  /**
   * Measure and log async operation performance
   * @param operation Operation name
   * @param fn Async function to measure
   * @param context Additional context
   * @returns Function result
   */
  static async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: LogContext
  ): Promise<T> {
    const startTime = performance.now();
    
    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      
      this.performanceLog(operation, duration, context);
      
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      this.error(`${operation} failed after ${duration}ms`, error as Error, context);
      throw error;
    }
  }
}

/**
 * Child logger with fixed context
 */
export class ChildLogger {
  constructor(private context: LogContext) {}
  
  debug(message: string, additionalContext?: LogContext): void {
    Logger.debug(message, { ...this.context, ...additionalContext });
  }
  
  info(message: string, additionalContext?: LogContext): void {
    Logger.info(message, { ...this.context, ...additionalContext });
  }
  
  warn(message: string, additionalContext?: LogContext): void {
    Logger.warn(message, { ...this.context, ...additionalContext });
  }
  
  error(message: string, error?: Error, additionalContext?: LogContext): void {
    Logger.error(message, error, { ...this.context, ...additionalContext });
  }
  
  auditLog(action: string, details: any): void {
    Logger.auditLog(action, details, this.context);
  }
  
  securityLog(event: string, details: any): void {
    Logger.securityLog(event, details, this.context);
  }
  
  performanceLog(operation: string, duration: number): void {
    Logger.performanceLog(operation, duration, this.context);
  }
}


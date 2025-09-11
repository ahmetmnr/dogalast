import { createLogger as createEnvLogger } from '@/config/environment'

export class Logger {
  private logger: ReturnType<typeof createEnvLogger>

  constructor(module?: string) {
    this.logger = createEnvLogger(module || 'default')
  }

  debug(message: string, ...args: any[]) {
    this.logger.debug(message, ...args)
  }

  info(message: string, ...args: any[]) {
    this.logger.info(message, ...args)
  }

  warn(message: string, ...args: any[]) {
    this.logger.warn(message, ...args)
  }

  error(message: string, error?: Error, context?: any) {
    if (error) {
      this.logger.error(message, { error: error.message, stack: error.stack, context })
    } else {
      this.logger.error(message, context)
    }
  }

  // Static methods for backward compatibility
  static debug(message: string, ...args: any[]) {
    const logger = new Logger('static')
    logger.debug(message, ...args)
  }

  static info(message: string, ...args: any[]) {
    const logger = new Logger('static')
    logger.info(message, ...args)
  }

  static warn(message: string, ...args: any[]) {
    const logger = new Logger('static')
    logger.warn(message, ...args)
  }

  static error(message: string, error?: Error, context?: any) {
    const logger = new Logger('static')
    logger.error(message, error, context)
  }
}
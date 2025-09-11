/**
 * Environment Variable Helpers
 * Type-safe environment variable access with validation
 */

import { ValidationResult } from './validation';

/**
 * Environment types
 */
export type EnvironmentType = 'development' | 'production';

/**
 * Required environment variables
 */
const REQUIRED_ENV_VARS = [
  'OPENAI_API_KEY',
  'JWT_SECRET',
  'ADMIN_JWT_SECRET',
] as const;

/**
 * Optional environment variables with defaults
 */
const OPTIONAL_ENV_VARS = {
  // CORS
  CORS_ORIGINS: 'http://localhost:8787',
  
  // Privacy and GDPR
  AUDIO_RETENTION_DAYS: '0',
  DATA_RETENTION_DAYS: '365',
  TRANSCRIPT_RETENTION_DAYS: '30',
  GDPR_COMPLIANCE_MODE: 'true',
  
  // Audio and Calibration
  VAD_CALIBRATION_ENABLED: 'true',
  DEFAULT_VAD_THRESHOLD: '0.01',
  
  // Token Management
  TOKEN_REFRESH_THRESHOLD: '0.75',
  EPHEMERAL_TOKEN_DURATION: '1h',
  
  // Performance
  RATE_LIMIT_REQUESTS_PER_MINUTE: '60',
  SESSION_TIMEOUT_SECONDS: '1800',
  MAX_QUESTIONS_PER_SESSION: '10',
  CACHE_TTL_SECONDS: '300',
  
  // Logging
  LOG_LEVEL: 'info',
  AUDIT_LOG_RETENTION_DAYS: '2555',
  
  // Environment
  ENVIRONMENT: 'development',
} as const;

/**
 * Environment utilities class
 */
export class Environment {
  private static env: Record<string, string | undefined> = {};
  private static initialized = false;

  /**
   * Initialize environment with values
   * @param env Environment variables object
   */
  static init(env: Record<string, string | undefined>): void {
    this.env = env;
    this.initialized = true;
  }

  /**
   * Get raw environment variable
   * @param key Variable name
   * @param defaultValue Default value if not found
   * @returns Variable value
   */
  private static get(key: string, defaultValue?: string): string | undefined {
    // In Cloudflare Workers, env is passed to handlers
    if (!this.initialized && typeof process !== 'undefined') {
      return process.env[key] || defaultValue;
    }
    
    return this.env[key] || defaultValue;
  }

  /**
   * Check if environment is development
   * @returns True if development
   */
  static isDevelopment(): boolean {
    return this.getEnvironment() === 'development';
  }

  /**
   * Check if environment is production
   * @returns True if production
   */
  static isProduction(): boolean {
    return this.getEnvironment() === 'production';
  }

  /**
   * Get current environment
   * @returns Environment type
   */
  static getEnvironment(): EnvironmentType {
    const env = this.get('ENVIRONMENT', 'development');
    return env === 'production' ? 'production' : 'development';
  }

  /**
   * Get audio retention days
   * @returns Number of days (0 = don't retain)
   */
  static getAudioRetentionDays(): number {
    const days = this.get('AUDIO_RETENTION_DAYS', OPTIONAL_ENV_VARS.AUDIO_RETENTION_DAYS);
    return parseInt(days || '0', 10);
  }

  /**
   * Get data retention days
   * @returns Number of days
   */
  static getDataRetentionDays(): number {
    const days = this.get('DATA_RETENTION_DAYS', OPTIONAL_ENV_VARS.DATA_RETENTION_DAYS);
    return parseInt(days || '365', 10);
  }

  /**
   * Get transcript retention days
   * @returns Number of days
   */
  static getTranscriptRetentionDays(): number {
    const days = this.get('TRANSCRIPT_RETENTION_DAYS', OPTIONAL_ENV_VARS.TRANSCRIPT_RETENTION_DAYS);
    return parseInt(days || '30', 10);
  }

  /**
   * Check if GDPR compliance mode is enabled
   * @returns True if enabled
   */
  static isGDPRComplianceEnabled(): boolean {
    const enabled = this.get('GDPR_COMPLIANCE_MODE', OPTIONAL_ENV_VARS.GDPR_COMPLIANCE_MODE);
    return enabled === 'true';
  }

  /**
   * Get token refresh threshold
   * @returns Threshold as percentage (0-1)
   */
  static getTokenRefreshThreshold(): number {
    const threshold = this.get('TOKEN_REFRESH_THRESHOLD', OPTIONAL_ENV_VARS.TOKEN_REFRESH_THRESHOLD);
    return parseFloat(threshold || '0.75');
  }

  /**
   * Check if VAD calibration is enabled
   * @returns True if enabled
   */
  static isVADCalibrationEnabled(): boolean {
    const enabled = this.get('VAD_CALIBRATION_ENABLED', OPTIONAL_ENV_VARS.VAD_CALIBRATION_ENABLED);
    return enabled !== 'false';
  }

  /**
   * Get rate limit per minute
   * @returns Request limit
   */
  static getRateLimitPerMinute(): number {
    const limit = this.get('RATE_LIMIT_REQUESTS_PER_MINUTE', OPTIONAL_ENV_VARS.RATE_LIMIT_REQUESTS_PER_MINUTE);
    return parseInt(limit || '60', 10);
  }

  /**
   * Get session timeout in seconds
   * @returns Timeout in seconds
   */
  static getSessionTimeoutSeconds(): number {
    const timeout = this.get('SESSION_TIMEOUT_SECONDS', OPTIONAL_ENV_VARS.SESSION_TIMEOUT_SECONDS);
    return parseInt(timeout || '1800', 10);
  }

  /**
   * Get cache TTL in seconds
   * @returns TTL in seconds
   */
  static getCacheTTLSeconds(): number {
    const ttl = this.get('CACHE_TTL_SECONDS', OPTIONAL_ENV_VARS.CACHE_TTL_SECONDS);
    return parseInt(ttl || '300', 10);
  }

  /**
   * Get maximum questions per session
   * @returns Maximum questions
   */
  static getMaxQuestionsPerSession(): number {
    const max = this.get('MAX_QUESTIONS_PER_SESSION', OPTIONAL_ENV_VARS.MAX_QUESTIONS_PER_SESSION);
    return parseInt(max || '10', 10);
  }

  /**
   * Get default VAD threshold
   * @returns VAD threshold (0-1)
   */
  static getDefaultVADThreshold(): number {
    const threshold = this.get('DEFAULT_VAD_THRESHOLD', OPTIONAL_ENV_VARS.DEFAULT_VAD_THRESHOLD);
    return parseFloat(threshold || '0.01');
  }

  /**
   * Get ephemeral token duration
   * @returns Duration string (e.g., '1h')
   */
  static getEphemeralTokenDuration(): string {
    return this.get('EPHEMERAL_TOKEN_DURATION', OPTIONAL_ENV_VARS.EPHEMERAL_TOKEN_DURATION) || '1h';
  }

  /**
   * Get log level
   * @returns Log level
   */
  static getLogLevel(): string {
    return this.get('LOG_LEVEL', OPTIONAL_ENV_VARS.LOG_LEVEL) || 'info';
  }

  /**
   * Get audit log retention days
   * @returns Retention days
   */
  static getAuditLogRetentionDays(): number {
    const days = this.get('AUDIT_LOG_RETENTION_DAYS', OPTIONAL_ENV_VARS.AUDIT_LOG_RETENTION_DAYS);
    return parseInt(days || '2555', 10); // 7 years for KVKK
  }

  /**
   * Get allowed CORS origins
   * @returns Array of allowed origins
   */
  static getAllowedOrigins(): string[] {
    const origins = this.get('CORS_ORIGINS', OPTIONAL_ENV_VARS.CORS_ORIGINS) || '';
    return origins.split(',').map(origin => origin.trim()).filter(Boolean);
  }

  /**
   * Check if origin is allowed
   * @param origin Origin to check
   * @returns True if allowed
   */
  static isOriginAllowed(origin: string): boolean {
    const allowedOrigins = this.getAllowedOrigins();
    
    // In development, allow localhost
    if (this.isDevelopment() && origin.includes('localhost')) {
      return true;
    }
    
    return allowedOrigins.includes(origin);
  }

  /**
   * Get API keys
   * @returns API key object (throws if missing in production)
   */
  static getAPIKeys() {
    const openAIKey = this.get('OPENAI_API_KEY');
    const jwtSecret = this.get('JWT_SECRET');
    const adminJwtSecret = this.get('ADMIN_JWT_SECRET');
    
    if (this.isProduction()) {
      if (!openAIKey) throw new Error('OPENAI_API_KEY is required in production');
      if (!jwtSecret) throw new Error('JWT_SECRET is required in production');
      if (!adminJwtSecret) throw new Error('ADMIN_JWT_SECRET is required in production');
    }
    
    return {
      openAI: openAIKey || 'dev-openai-key',
      jwt: jwtSecret || 'dev-jwt-secret',
      adminJwt: adminJwtSecret || 'dev-admin-jwt-secret',
    };
  }
  
  /**
   * Get JWT secret
   * @returns JWT secret
   */
  static getJWTSecret(): string {
    const secret = this.get('JWT_SECRET');
    
    if (!secret && this.isProduction()) {
      throw new Error('JWT_SECRET is not configured');
    }
    
    return secret || 'dev-jwt-secret';
  }
  
  /**
   * Get Admin JWT secret
   * @returns Admin JWT secret
   */
  static getAdminJWTSecret(): string {
    const secret = this.get('ADMIN_JWT_SECRET');
    
    if (!secret && this.isProduction()) {
      return this.getJWTSecret(); // Fallback to regular JWT secret
    }
    
    return secret || this.getJWTSecret();
  }
  
  /**
   * Get OpenAI API key
   * @returns OpenAI API key
   */
  static getOpenAIApiKey(): string {
    const apiKey = this.get('OPENAI_API_KEY');
    
    if (!apiKey && this.isProduction()) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    
    return apiKey || 'dev-openai-key';
  }

  /**
   * Validate all environment variables
   * @returns Validation result
   */
  static validateEnvironmentVariables(): ValidationResult {
    const errors: string[] = [];
    const missing = this.getMissingEnvVars();
    
    if (missing.length > 0) {
      errors.push(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    // Validate numeric values
    const numericVars = [
      { key: 'AUDIO_RETENTION_DAYS', min: 0, max: 365 },
      { key: 'DATA_RETENTION_DAYS', min: 0, max: 3650 },
      { key: 'RATE_LIMIT_REQUESTS_PER_MINUTE', min: 1, max: 1000 },
      { key: 'SESSION_TIMEOUT_SECONDS', min: 60, max: 86400 },
    ];
    
    for (const { key, min, max } of numericVars) {
      const value = this.get(key);
      if (value) {
        const num = parseInt(value, 10);
        if (isNaN(num) || num < min || num > max) {
          errors.push(`${key} must be a number between ${min} and ${max}`);
        }
      }
    }
    
    // Validate boolean values
    const booleanVars = ['GDPR_COMPLIANCE_MODE', 'VAD_CALIBRATION_ENABLED'];
    for (const key of booleanVars) {
      const value = this.get(key);
      if (value && !['true', 'false'].includes(value)) {
        errors.push(`${key} must be 'true' or 'false'`);
      }
    }
    
    // Validate percentage values
    const percentageVars = [
      { key: 'TOKEN_REFRESH_THRESHOLD', min: 0, max: 1 },
      { key: 'DEFAULT_VAD_THRESHOLD', min: 0, max: 1 },
    ];
    
    for (const { key, min, max } of percentageVars) {
      const value = this.get(key);
      if (value) {
        const num = parseFloat(value);
        if (isNaN(num) || num < min || num > max) {
          errors.push(`${key} must be a number between ${min} and ${max}`);
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get list of required environment variables
   * @returns Array of required variable names
   */
  static getRequiredEnvVars(): string[] {
    return [...REQUIRED_ENV_VARS];
  }

  /**
   * Get missing environment variables
   * @returns Array of missing variable names
   */
  static getMissingEnvVars(): string[] {
    if (this.isDevelopment()) {
      return []; // More lenient in development
    }
    
    return REQUIRED_ENV_VARS.filter(key => !this.get(key));
  }

  /**
   * Get all environment variables (for debugging)
   * @param maskSecrets Whether to mask sensitive values
   * @returns Environment variables object
   */
  static getAll(maskSecrets: boolean = true): Record<string, string | undefined> {
    const all: Record<string, string | undefined> = {};
    
    // Get all defined variables
    const allVars = [
      ...REQUIRED_ENV_VARS,
      ...Object.keys(OPTIONAL_ENV_VARS),
    ];
    
    for (const key of allVars) {
      const value = this.get(key);
      
      if (maskSecrets && this.isSensitiveVar(key) && value) {
        all[key] = '***MASKED***';
      } else {
        all[key] = value;
      }
    }
    
    return all;
  }

  /**
   * Check if variable name is sensitive
   * @param key Variable name
   * @returns True if sensitive
   */
  private static isSensitiveVar(key: string): boolean {
    const sensitivePatterns = [
      'KEY',
      'SECRET',
      'PASSWORD',
      'TOKEN',
      'CREDENTIAL',
    ];
    
    return sensitivePatterns.some(pattern => 
      key.toUpperCase().includes(pattern)
    );
  }
}

/**
 * Cryptographic Utilities
 * Secure operations for JWT, hashing, and encryption
 */

import { SignJWT, jwtVerify } from 'jose';

/**
 * JWT payload interface
 */
export interface JWTPayload {
  sub?: string;
  userId?: number;
  sessionId?: string;
  role?: string;
  permissions?: string[];
  iat?: number;
  exp?: number;
  [key: string]: any;
}

/**
 * Encryption result
 */
export interface EncryptionResult {
  encrypted: string;
  iv: string;
  authTag: string;
}

/**
 * Cryptographic utilities class
 */
export class CryptoUtils {
  private static readonly IV_LENGTH = 16;

  /**
   * Generate a secure JWT token
   * @param payload Token payload
   * @param secret JWT secret key
   * @param expiresIn Expiration time (e.g., '1h', '7d')
   * @returns Signed JWT token
   */
  static async generateSecureJWT(
    payload: JWTPayload,
    secret: string,
    expiresIn: string = '1h'
  ): Promise<string> {
    try {
      const secretKey = new TextEncoder().encode(secret);
      
      const jwt = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(secretKey);
      
      return jwt;
    } catch (error) {
      throw new Error(`JWT generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify and decode a JWT token
   * @param token JWT token to verify
   * @param secret JWT secret key
   * @returns Decoded payload
   */
  static async verifyJWT(token: string, secret: string): Promise<JWTPayload> {
    try {
      const secretKey = new TextEncoder().encode(secret);
      
      const { payload } = await jwtVerify(token, secretKey, {
        algorithms: ['HS256'],
      });
      
      return payload as JWTPayload;
    } catch (error) {
      throw new Error(`JWT verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate an ephemeral token for OpenAI Realtime API
   * @param sessionId Session ID
   * @param expiresIn Expiration time
   * @returns Ephemeral token
   */
  static async generateEphemeralToken(
    sessionId: string,
    expiresIn: string = '1h'
  ): Promise<string> {
    const payload: JWTPayload = {
      sub: sessionId,
      type: 'ephemeral',
      sessionId,
      scope: 'openai.realtime',
    };

    // Use a specific secret for ephemeral tokens
    const ephemeralSecret = process.env['EPHEMERAL_TOKEN_SECRET'] || process.env['JWT_SECRET'] || '';
    
    return this.generateSecureJWT(payload, ephemeralSecret, expiresIn);
  }

  /**
   * Hash a password using Web Crypto API
   * @param password Plain text password
   * @returns Hashed password with salt
   */
  static async hashPassword(password: string): Promise<string> {
    try {
      // Generate a random salt
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltHex = Array.from(salt)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Convert password to Uint8Array
      const encoder = new TextEncoder();
      const passwordData = encoder.encode(password + saltHex);
      
      // Hash using SHA-256 (multiple rounds for security)
      let hash = passwordData;
      for (let i = 0; i < 10000; i++) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', hash);
        hash = new Uint8Array(hashBuffer);
      }
      
      // Convert to hex
      const hashHex = Array.from(hash)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Return salt and hash combined
      return `${saltHex}:${hashHex}`;
    } catch (error) {
      throw new Error(`Password hashing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify a password against a hash
   * @param password Plain text password
   * @param hash Stored password hash
   * @returns True if password matches
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      const [salt, expectedHash] = hash.split(':');
      
      if (!salt || !expectedHash) {
        throw new Error('Invalid hash format');
      }
      
      // Hash the password with the same salt
      const encoder = new TextEncoder();
      const passwordData = encoder.encode(password + salt);
      
      // Hash using SHA-256 (same number of rounds)
      let currentHash = passwordData;
      for (let i = 0; i < 10000; i++) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', currentHash);
        currentHash = new Uint8Array(hashBuffer);
      }
      
      // Convert to hex
      const currentHashHex = Array.from(currentHash)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Constant-time comparison
      return this.constantTimeCompare(currentHashHex, expectedHash);
    } catch (error) {
      console.error('Password verification error:', error);
      return false;
    }
  }

  /**
   * Generate a cryptographically secure ID
   * @returns Secure random ID
   */
  static generateSecureId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Generate a session ID
   * @returns Session ID in UUID v4 format
   */
  static generateSessionId(): string {
    // Use Web Crypto API for UUID v4
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }
    
    // Fallback UUID v4 implementation
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    
    // Set version (4) and variant bits
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    
    // Convert to hex string
    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Format as UUID
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20, 32),
    ].join('-');
  }

  /**
   * Encrypt sensitive data using Web Crypto API
   * @param data Data to encrypt
   * @param key Encryption key
   * @returns Encrypted data with IV and auth tag
   */
  static async encrypt(data: string, key: string): Promise<EncryptionResult> {
    try {
      // Generate IV
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
      
      // Derive key from string
      const encoder = new TextEncoder();
      const keyData = encoder.encode(key);
      const keyHash = await crypto.subtle.digest('SHA-256', keyData);
      
      // Import key
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyHash,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );
      
      // Encrypt
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encoder.encode(data)
      );
      
      // Extract auth tag (last 16 bytes)
      const encryptedArray = new Uint8Array(encrypted);
      const ciphertext = encryptedArray.slice(0, -16);
      const authTag = encryptedArray.slice(-16);
      
      // Convert to hex
      const toHex = (bytes: Uint8Array) => 
        Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      
      return {
        encrypted: toHex(ciphertext),
        iv: toHex(iv),
        authTag: toHex(authTag),
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt data using Web Crypto API
   * @param encryptedData Encrypted data (hex)
   * @param key Encryption key
   * @param iv Initialization vector (hex)
   * @param authTag Authentication tag (hex)
   * @returns Decrypted data
   */
  static async decrypt(
    encryptedData: string,
    key: string,
    iv: string,
    authTag: string
  ): Promise<string> {
    try {
      // Convert hex to bytes
      const fromHex = (hex: string) => {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
      };
      
      // Derive key from string
      const encoder = new TextEncoder();
      const keyData = encoder.encode(key);
      const keyHash = await crypto.subtle.digest('SHA-256', keyData);
      
      // Import key
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyHash,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );
      
      // Combine ciphertext and auth tag
      const ciphertext = fromHex(encryptedData);
      const tag = fromHex(authTag);
      const combined = new Uint8Array(ciphertext.length + tag.length);
      combined.set(ciphertext);
      combined.set(tag, ciphertext.length);
      
      // Decrypt
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromHex(iv) },
        cryptoKey,
        combined
      );
      
      // Convert to string
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a secure random token
   * @param length Token length in bytes
   * @returns Hex encoded token
   */
  static generateToken(length: number = 32): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Hash data using SHA-256
   * @param data Data to hash
   * @returns Hash hex string
   */
  static async hash(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Generate HMAC signature
   * @param data Data to sign
   * @param secret HMAC secret
   * @returns HMAC signature
   */
  static async hmac(data: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    
    // Import secret as HMAC key
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    // Sign data
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(data)
    );
    
    // Convert to hex
    const signatureArray = new Uint8Array(signature);
    return Array.from(signatureArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Constant-time string comparison
   * @param a First string
   * @param b Second string
   * @returns True if strings are equal
   */
  static constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
  }

  /**
   * Generate a time-based OTP (for 2FA)
   * @param secret Shared secret
   * @param window Time window (30 seconds default)
   * @returns 6-digit OTP
   */
  static async generateTOTP(secret: string, window: number = 30): Promise<string> {
    const counter = Math.floor(Date.now() / 1000 / window);
    const data = secret + counter.toString();
    const hash = await this.hash(data);
    
    // Extract 6 digits from hash
    const offset = parseInt(hash.substring(hash.length - 1), 16);
    const code = parseInt(hash.substring(offset * 2, offset * 2 + 12), 16) % 1000000;
    
    return code.toString().padStart(6, '0');
  }

  /**
   * Verify TOTP code
   * @param code User provided code
   * @param secret Shared secret
   * @param window Time window
   * @param tolerance Number of windows to check (past and future)
   * @returns True if code is valid
   */
  static async verifyTOTP(
    code: string,
    secret: string,
    window: number = 30,
    tolerance: number = 1
  ): Promise<boolean> {
    const currentTime = Math.floor(Date.now() / 1000 / window);
    
    for (let i = -tolerance; i <= tolerance; i++) {
      const testTime = currentTime + i;
      const data = secret + testTime.toString();
      const hash = await this.hash(data);
      
      // Extract 6 digits from hash
      const offset = parseInt(hash.substring(hash.length - 1), 16);
      const testCode = (parseInt(hash.substring(offset * 2, offset * 2 + 12), 16) % 1000000)
        .toString()
        .padStart(6, '0');
      
      if (this.constantTimeCompare(code, testCode)) {
        return true;
      }
    }
    
    return false;
  }
}

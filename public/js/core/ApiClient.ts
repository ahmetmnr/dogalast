/**
 * API Client for Zero Waste Quiz
 * Type-safe communication with backend API
 */

// ============================================================================
// Types (shared with backend)
// ============================================================================

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, any>;
  };
  timestamp: string;
  timing?: {
    serverTimestamp: number;
    processingTime: number;
  };
}

export interface RegistrationRequest {
  name: string;
  email?: string;
  phone?: string;
  consentMarketing: boolean;
  consentTerms: boolean;
}

export interface RegistrationResponse {
  participantId: number;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AdminLoginRequest {
  username: string;
  password: string;
}

export interface AdminLoginResponse {
  adminId: number;
  username: string;
  role: 'admin' | 'super_admin';
  permissions: string[];
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface ToolDispatchRequest {
  tool: string;
  args: Record<string, any>;
  sessionId?: string;
}

export interface LeaderboardEntry {
  rank: number;
  participantId: number;
  name: string;
  score: number;
  completedAt: Date;
  avgResponseTime: number;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  generatedAt: string;
}

// ============================================================================
// API Client Error
// ============================================================================

export class APIClientError extends Error {
  constructor(
    message: string,
    public code: string = 'API_ERROR',
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'APIClientError';
  }
}

// ============================================================================
// Environment Configuration
// ============================================================================

interface EnvironmentConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  debugMode: boolean;
  cacheTTL: number;
  requestTimeout: number;
  maxRetries: number;
}

const getEnvironmentConfig = (): EnvironmentConfig => {
  // Check if we're in development mode
  const isDev = window.location.hostname === 'localhost' || 
                window.location.hostname === '127.0.0.1';
  
  return {
    apiBaseUrl: isDev ? 'http://localhost:8787' : '',
    wsBaseUrl: isDev ? 'ws://localhost:8787' : '',
    debugMode: isDev,
    cacheTTL: 5 * 60 * 1000, // 5 minutes
    requestTimeout: 30 * 1000, // 30 seconds
    maxRetries: 3,
  };
};

// ============================================================================
// Cache Entry Interface
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// ============================================================================
// API Client Class
// ============================================================================

export class APIClient {
  private config: EnvironmentConfig;
  private authToken: string | null = null;
  private cache = new Map<string, CacheEntry<any>>();
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.config = getEnvironmentConfig();
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    this.loadAuthToken();
  }

  /**
   * Authentication methods
   */
  setAuthToken(token: string): void {
    this.authToken = token;
    this.saveAuthToken(token);
  }

  clearAuthToken(): void {
    this.authToken = null;
    this.removeAuthToken();
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  isAuthenticated(): boolean {
    return this.authToken !== null;
  }

  /**
   * Generic request method
   */
  async request<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: any;
      headers?: Record<string, string>;
      cache?: boolean;
      timeout?: number;
      retries?: number;
    } = {}
  ): Promise<APIResponse<T>> {
    const {
      method = 'GET',
      body,
      headers = {},
      cache = method === 'GET',
      timeout = this.config.requestTimeout,
      retries = this.config.maxRetries,
    } = options;

    const url = `${this.config.apiBaseUrl}${endpoint}`;
    const cacheKey = `${method}:${url}:${JSON.stringify(body || {})}`;

    // Check cache for GET requests
    if (cache && method === 'GET') {
      const cached = this.getFromCache<T>(cacheKey);
      if (cached) {
        if (this.config.debugMode) {
          console.log('Cache hit:', endpoint);
        }
        return cached;
      }
    }

    // Prepare headers
    const requestHeaders = {
      ...this.defaultHeaders,
      ...headers,
    };

    // Add auth token if available
    if (this.authToken) {
      requestHeaders.Authorization = `Bearer ${this.authToken}`;
    }

    // Prepare request options
    const requestOptions: RequestInit = {
      method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(timeout),
    };

    // Add body for non-GET requests
    if (body && method !== 'GET') {
      requestOptions.body = JSON.stringify(body);
    }

    // Retry logic with exponential backoff
    let lastError: Error;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (this.config.debugMode) {
          console.log(`API Request [${attempt + 1}/${retries + 1}]:`, method, endpoint, body);
        }

        const response = await fetch(url, requestOptions);
        const result = await this.handleResponse<T>(response);

        // Cache successful GET requests
        if (cache && method === 'GET' && result.success) {
          this.setCache(cacheKey, result);
        }

        if (this.config.debugMode) {
          console.log('API Response:', endpoint, result);
        }

        return result;

      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (error instanceof APIClientError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * HTTP method helpers
   */
  async get<T>(endpoint: string, options?: { cache?: boolean; timeout?: number }): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET', ...options });
  }

  async post<T>(endpoint: string, body?: any, options?: { headers?: Record<string, string>; timeout?: number }): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { method: 'POST', body, ...options });
  }

  async put<T>(endpoint: string, body?: any, options?: { headers?: Record<string, string> }): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { method: 'PUT', body, ...options });
  }

  async delete<T>(endpoint: string, options?: { timeout?: number }): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE', ...options });
  }

  /**
   * Response handling
   */
  private async handleResponse<T>(response: Response): Promise<APIResponse<T>> {
    let responseData: any;

    try {
      responseData = await response.json();
    } catch (error) {
      throw new APIClientError(
        'Invalid JSON response',
        'INVALID_RESPONSE',
        response.status
      );
    }

    if (!response.ok) {
      const errorCode = responseData.error?.code || 'HTTP_ERROR';
      const errorMessage = responseData.error?.message || `HTTP ${response.status}`;

      throw new APIClientError(
        errorMessage,
        errorCode,
        response.status,
        responseData.error?.details
      );
    }

    return responseData as APIResponse<T>;
  }

  /**
   * Cache management
   */
  private getFromCache<T>(key: string): APIResponse<T> | null {
    const entry = this.cache.get(key);

    if (entry && entry.expiresAt > Date.now()) {
      return entry.data;
    }

    if (entry) {
      this.cache.delete(key);
    }

    return null;
  }

  private setCache<T>(key: string, data: APIResponse<T>): void {
    const expiresAt = Date.now() + this.config.cacheTTL;

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt,
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Auth token persistence
   */
  private loadAuthToken(): void {
    try {
      const stored = localStorage.getItem('zero_waste_auth_token');
      if (stored) {
        this.authToken = stored;
      }
    } catch (error) {
      console.warn('Failed to load auth token:', error);
    }
  }

  private saveAuthToken(token: string): void {
    try {
      localStorage.setItem('zero_waste_auth_token', token);
    } catch (error) {
      console.warn('Failed to save auth token:', error);
    }
  }

  private removeAuthToken(): void {
    try {
      localStorage.removeItem('zero_waste_auth_token');
    } catch (error) {
      console.warn('Failed to remove auth token:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton API Client Instance
// ============================================================================

export const apiClient = new APIClient();

// ============================================================================
// Convenience API Methods
// ============================================================================

export const api = {
  // Authentication
  auth: {
    register: (data: RegistrationRequest) => 
      apiClient.post<RegistrationResponse>('/api/register', data),

    adminLogin: (data: AdminLoginRequest) => 
      apiClient.post<AdminLoginResponse>('/api/admin/login', data),

    getEphemeralToken: (sessionId: string) => 
      apiClient.get(`/api/realtime/token?sessionId=${sessionId}`),

    refreshToken: (sessionId: string) => 
      apiClient.post('/api/realtime/refresh-token', { sessionId }),

    resumeSession: (sessionId: string, lastEventId?: string) => 
      apiClient.post('/api/session/resume', { sessionId, lastEventId }),

    logout: () => 
      apiClient.post('/api/logout'),
  },

  // Quiz operations
  quiz: {
    start: () => 
      apiClient.post('/api/quiz/start'),

    finish: (sessionId: string) => 
      apiClient.post('/api/quiz/finish', { sessionId }),

    getSessionStatus: (sessionId: string) => 
      apiClient.get(`/api/session/${sessionId}/status`),
  },

  // Tool dispatch (core quiz functionality)
  tools: {
    dispatch: <T = any>(request: ToolDispatchRequest, idempotencyKey?: string) => {
      const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
      return apiClient.post<T>('/api/tools/dispatch', request, { headers });
    },

    // Convenience methods for specific tools
    startQuiz: () => 
      api.tools.dispatch({ tool: 'startQuiz', args: {} }),

    nextQuestion: (sessionId: string) => 
      api.tools.dispatch({ tool: 'nextQuestion', args: {}, sessionId }),

    markTTSEnd: (sessionQuestionId: string, clientTimestamp?: number) => 
      api.tools.dispatch({
        tool: 'markTTSEnd',
        args: { sessionQuestionId, clientTimestamp }
      }),

    markSpeechStart: (sessionQuestionId: string, vadThreshold: number, clientTimestamp?: number) => 
      api.tools.dispatch({
        tool: 'markSpeechStart',
        args: { sessionQuestionId, vadThreshold, clientTimestamp }
      }),

    submitAnswer: (sessionQuestionId: string, answer: string, confidence: number, clientTimestamp?: number) => 
      api.tools.dispatch({
        tool: 'submitAnswer',
        args: { sessionQuestionId, answer, confidence, clientTimestamp }
      }),

    finishQuiz: (sessionId: string) => 
      api.tools.dispatch({ tool: 'finishQuiz', args: {}, sessionId }),

    infoLookup: (query: string) => 
      api.tools.dispatch({ tool: 'infoLookup', args: { query } }),
  },

  // Leaderboard
  leaderboard: {
    get: (limit: number = 10, offset: number = 0) => 
      apiClient.get<LeaderboardResponse>(`/api/leaderboard?limit=${limit}&offset=${offset}`),
  },

  // Admin endpoints
  admin: {
    // Question management
    questions: {
      list: (params?: { page?: number; pageSize?: number; search?: string }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', params.page.toString());
        if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
        if (params?.search) query.set('search', params.search);
        
        return apiClient.get(`/api/admin/questions?${query.toString()}`);
      },

      create: (questionData: any) => 
        apiClient.post('/api/admin/questions', questionData),

      update: (id: string, updates: any) => 
        apiClient.put(`/api/admin/questions/${id}`, updates),

      delete: (id: string) => 
        apiClient.delete(`/api/admin/questions/${id}`),
    },

    // User management
    users: {
      list: (params?: { page?: number; pageSize?: number; search?: string }) => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', params.page.toString());
        if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
        if (params?.search) query.set('search', params.search);
        
        return apiClient.get(`/api/admin/users?${query.toString()}`);
      },

      manage: (id: number, action: string, reason?: string) => 
        apiClient.post(`/api/admin/users/${id}/manage`, { action, reason }),
    },

    // Authentication & Dashboard
    login: (credentials: { username: string; password: string }) =>
      apiClient.post('/api/admin/login', credentials),

    logout: () =>
      apiClient.post('/api/admin/logout'),

    verifyToken: () =>
      apiClient.get('/api/admin/verify'),

    getDashboardStats: () =>
      apiClient.get('/api/admin/dashboard/stats'),

    exportDashboardReport: (format: string) =>
      apiClient.get(`/api/admin/dashboard/export?format=${format}`),

    // Questions
    getQuestions: () =>
      apiClient.get('/api/admin/questions'),

    createQuestion: (questionData: any) =>
      apiClient.post('/api/admin/questions', questionData),

    updateQuestion: (questionId: string, updates: any) =>
      apiClient.put(`/api/admin/questions/${questionId}`, updates),

    deleteQuestion: (questionId: string) =>
      apiClient.delete(`/api/admin/questions/${questionId}`),

    bulkDeleteQuestions: (questionIds: string[]) =>
      apiClient.delete('/api/admin/questions/bulk-delete', { questionIds }),

    bulkUpdateQuestionStatus: (questionIds: string[], isActive: boolean) =>
      apiClient.put('/api/admin/questions/bulk-status', { questionIds, isActive }),

    // Analytics
    getAnalytics: (params: any) => {
      const query = new URLSearchParams(params);
      return apiClient.get(`/api/admin/analytics?${query.toString()}`);
    },

    exportAnalyticsReport: (params: any) => {
      const query = new URLSearchParams(params);
      return apiClient.get(`/api/admin/analytics/export?${query.toString()}`);
    },

    // System
    stats: () => 
      apiClient.get('/api/admin/stats'),

    auditLogs: (params?: { page?: number; pageSize?: number; tableName?: string; action?: string }) => {
      const query = new URLSearchParams();
      if (params?.page) query.set('page', params.page.toString());
      if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
      if (params?.tableName) query.set('tableName', params.tableName);
      if (params?.action) query.set('action', params.action);
      
      return apiClient.get(`/api/admin/audit-logs?${query.toString()}`);
    },

    settings: () => 
      apiClient.get('/api/admin/settings'),
  },
};

export default apiClient;

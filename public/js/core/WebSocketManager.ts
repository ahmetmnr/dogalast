/**
 * WebSocket Manager
 * Real-time communication with backend for leaderboard updates and quiz events
 */

import { apiClient } from './ApiClient.ts';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface WebSocketConfig {
  url: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  messageQueueSize: number;
}

export type WSConnectionState = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'reconnecting' 
  | 'failed';

export interface WSEventHandler<T = any> {
  (message: T): void;
}

interface QueuedMessage {
  message: any;
  timestamp: number;
  retries: number;
}

export interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: number;
  messageId: string;
}

export interface LeaderboardUpdateMessage extends WebSocketMessage {
  type: 'leaderboard_update';
  payload: {
    updatedEntry: any;
    newRankings: any[];
  };
}

export interface QuizEventMessage extends WebSocketMessage {
  type: 'quiz_event';
  payload: {
    sessionId: string;
    eventType: string;
    data: any;
  };
}

// ============================================================================
// WebSocket Manager Class
// ============================================================================

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private connectionState: WSConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private heartbeatTimer: number | null = null;
  private messageQueue: QueuedMessage[] = [];
  private eventHandlers = new Map<string, Set<WSEventHandler>>();
  private lastHeartbeat = 0;

  constructor(config: Partial<WebSocketConfig> = {}) {
    // Detect environment and set default WebSocket URL
    const isDev = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1';
    
    const defaultWsUrl = isDev 
      ? 'ws://localhost:8787' 
      : `wss://${window.location.host}`;

    this.config = {
      url: defaultWsUrl,
      reconnectInterval: 1000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000, // 30 seconds
      messageQueueSize: 100,
      ...config
    };
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }

    try {
      this.setConnectionState('connecting');

      // Get auth token
      const authToken = apiClient.getAuthToken();
      if (!authToken) {
        throw new Error('Authentication token required for WebSocket connection');
      }

      // Construct WebSocket URL with auth
      const wsUrl = `${this.config.url}/ws?token=${encodeURIComponent(authToken)}`;

      // Create WebSocket connection
      this.ws = new WebSocket(wsUrl);

      // Setup event handlers
      this.setupWebSocketHandlers();

      // Wait for connection
      await this.waitForConnection();

      this.setConnectionState('connected');
      this.reconnectAttempts = 0;

      // Start heartbeat
      this.startHeartbeat();

      // Process queued messages
      this.processMessageQueue();

      console.log('WebSocket connected successfully to:', this.config.url);

    } catch (error) {
      console.error('WebSocket connection failed:', error);
      this.setConnectionState('failed');

      if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
        await this.scheduleReconnect();
      } else {
        this.emit('error', {
          code: 'MAX_RECONNECT_ATTEMPTS',
          message: 'Maksimum yeniden bağlanma denemesi aşıldı'
        });
      }
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.reconnectAttempts = this.config.maxReconnectAttempts; // Prevent reconnection

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setConnectionState('disconnected');
    console.log('WebSocket disconnected');
  }

  /**
   * Send message to server
   */
  send(message: any): void {
    if (this.connectionState === 'connected' && this.ws) {
      try {
        const wsMessage: WebSocketMessage = {
          type: message.type,
          payload: message.payload || message,
          timestamp: Date.now(),
          messageId: this.generateMessageId()
        };

        this.ws.send(JSON.stringify(wsMessage));

        if (__DEV__) {
          console.log('WebSocket message sent:', wsMessage.type);
        }

      } catch (error) {
        console.error('Failed to send WebSocket message:', error);
        this.queueMessage(message);
      }
    } else {
      // Queue message for later sending
      this.queueMessage(message);
      console.log('Message queued (not connected):', message.type);
    }
  }

  /**
   * Subscribe to message type
   */
  on<T = any>(messageType: string, handler: WSEventHandler<T>): void {
    if (!this.eventHandlers.has(messageType)) {
      this.eventHandlers.set(messageType, new Set());
    }
    this.eventHandlers.get(messageType)!.add(handler);
  }

  /**
   * Unsubscribe from message type
   */
  off<T = any>(messageType: string, handler: WSEventHandler<T>): void {
    const handlers = this.eventHandlers.get(messageType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(messageType);
      }
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): WSConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    state: WSConnectionState;
    reconnectAttempts: number;
    lastHeartbeat: number;
    queuedMessages: number;
  } {
    return {
      state: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      lastHeartbeat: this.lastHeartbeat,
      queuedMessages: this.messageQueue.length
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('WebSocket connection opened');
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket connection closed:', event.code, event.reason);

      this.stopHeartbeat();

      if (this.connectionState === 'connected') {
        this.setConnectionState('disconnected');
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', {
        code: 'WEBSOCKET_ERROR',
        message: 'WebSocket bağlantı hatası',
        details: error
      });
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event);
    };
  }

  /**
   * Wait for WebSocket connection to open
   */
  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      const onOpen = () => {
        clearTimeout(timeout);
        this.ws!.removeEventListener('open', onOpen);
        this.ws!.removeEventListener('error', onError);
        resolve();
      };

      const onError = (error: Event) => {
        clearTimeout(timeout);
        this.ws!.removeEventListener('open', onOpen);
        this.ws!.removeEventListener('error', onError);
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onError);
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);

      if (__DEV__) {
        console.log('WebSocket message received:', message.type);
      }

      // Handle system messages
      switch (message.type) {
        case 'heartbeat':
          this.handleHeartbeat(message);
          break;

        case 'heartbeat_response':
          this.lastHeartbeat = Date.now();
          break;

        case 'leaderboard_update':
          this.handleLeaderboardUpdate(message as LeaderboardUpdateMessage);
          break;

        case 'quiz_event':
          this.handleQuizEvent(message as QuizEventMessage);
          break;

        case 'connection_established':
          console.log('WebSocket connection established');
          break;

        case 'error':
          this.handleServerError(message);
          break;

        default:
          // Emit to registered handlers
          this.emit(message.type, message);
      }

    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Handle heartbeat message from server
   */
  private handleHeartbeat(message: WebSocketMessage): void {
    // Send heartbeat response
    this.send({
      type: 'heartbeat_response',
      timestamp: Date.now()
    });
  }

  /**
   * Handle leaderboard update
   */
  private handleLeaderboardUpdate(message: LeaderboardUpdateMessage): void {
    console.log('Leaderboard updated:', message.payload);
    this.emit('leaderboard_update', message.payload);
  }

  /**
   * Handle quiz event
   */
  private handleQuizEvent(message: QuizEventMessage): void {
    console.log('Quiz event received:', message.payload.eventType);
    this.emit('quiz_event', message.payload);
  }

  /**
   * Handle server error
   */
  private handleServerError(message: WebSocketMessage): void {
    console.error('Server error received:', message.payload);
    this.emit('server_error', message.payload);
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = window.setInterval(() => {
      if (this.isConnected()) {
        this.send({
          type: 'heartbeat',
          timestamp: Date.now()
        });
      }
    }, this.config.heartbeatInterval);

    console.log('WebSocket heartbeat started');
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Queue message for later sending
   */
  private queueMessage(message: any): void {
    // Remove oldest messages if queue is full
    if (this.messageQueue.length >= this.config.messageQueueSize) {
      this.messageQueue.shift();
    }

    this.messageQueue.push({
      message,
      timestamp: Date.now(),
      retries: 0
    });
  }

  /**
   * Process queued messages
   */
  private processMessageQueue(): void {
    console.log(`Processing ${this.messageQueue.length} queued messages`);

    while (this.messageQueue.length > 0 && this.isConnected()) {
      const queuedMessage = this.messageQueue.shift()!;

      try {
        this.send(queuedMessage.message);
      } catch (error) {
        // Re-queue if retries available
        if (queuedMessage.retries < 3) {
          queuedMessage.retries++;
          this.messageQueue.unshift(queuedMessage);
          break;
        } else {
          console.error('Failed to send queued message after retries:', error);
        }
      }
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setConnectionState('failed');
      return;
    }

    this.reconnectAttempts++;
    this.setConnectionState('reconnecting');

    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    console.log(`WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('WebSocket reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Set connection state and emit event
   */
  private setConnectionState(state: WSConnectionState): void {
    if (this.connectionState !== state) {
      const previousState = this.connectionState;
      this.connectionState = state;
      
      console.log(`WebSocket state changed: ${previousState} → ${state}`);
      
      this.emit('connectionStateChange', { 
        state, 
        previousState,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Emit event to handlers
   */
  private emit(eventType: string, data: any): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error('WebSocket event handler error:', error);
        }
      });
    }
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Singleton WebSocket Manager Instance
// ============================================================================

export const webSocketManager = new WebSocketManager();

// ============================================================================
// WebSocket Event Helpers
// ============================================================================

export class WebSocketEventHelper {
  /**
   * Setup leaderboard real-time updates
   */
  static setupLeaderboardUpdates(
    onUpdate: (leaderboard: any[]) => void,
    onError?: (error: any) => void
  ): () => void {
    const updateHandler = (data: any) => {
      if (data.newRankings) {
        onUpdate(data.newRankings);
      }
    };

    const errorHandler = (error: any) => {
      console.error('Leaderboard update error:', error);
      if (onError) {
        onError(error);
      }
    };

    webSocketManager.on('leaderboard_update', updateHandler);
    webSocketManager.on('error', errorHandler);

    // Return cleanup function
    return () => {
      webSocketManager.off('leaderboard_update', updateHandler);
      webSocketManager.off('error', errorHandler);
    };
  }

  /**
   * Setup quiz event handling
   */
  static setupQuizEvents(
    onQuizEvent: (event: any) => void,
    sessionId?: string
  ): () => void {
    const eventHandler = (data: any) => {
      // Filter by session ID if provided
      if (sessionId && data.sessionId !== sessionId) {
        return;
      }
      
      onQuizEvent(data);
    };

    webSocketManager.on('quiz_event', eventHandler);

    // Return cleanup function
    return () => {
      webSocketManager.off('quiz_event', eventHandler);
    };
  }

  /**
   * Setup connection monitoring
   */
  static setupConnectionMonitoring(
    onStateChange: (state: WSConnectionState) => void
  ): () => void {
    const stateHandler = (data: any) => {
      onStateChange(data.state);
    };

    webSocketManager.on('connectionStateChange', stateHandler);

    // Return cleanup function
    return () => {
      webSocketManager.off('connectionStateChange', stateHandler);
    };
  }
}

// ============================================================================
// Auto-connect WebSocket when authenticated
// ============================================================================

// Check if user is authenticated and auto-connect
if (apiClient.isAuthenticated()) {
  webSocketManager.connect().catch(error => {
    console.log('Auto WebSocket connection failed:', error);
  });
}

// Listen for authentication changes
let authCheckInterval: number | null = null;

function startAuthMonitoring() {
  if (authCheckInterval) return;
  
  authCheckInterval = window.setInterval(() => {
    const isAuth = apiClient.isAuthenticated();
    const isConnected = webSocketManager.isConnected();
    
    if (isAuth && !isConnected) {
      // User authenticated but WebSocket not connected
      webSocketManager.connect().catch(error => {
        console.log('Auto WebSocket connection failed:', error);
      });
    } else if (!isAuth && isConnected) {
      // User logged out, disconnect WebSocket
      webSocketManager.disconnect();
    }
  }, 5000); // Check every 5 seconds
}

function stopAuthMonitoring() {
  if (authCheckInterval) {
    clearInterval(authCheckInterval);
    authCheckInterval = null;
  }
}

// Start monitoring
startAuthMonitoring();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopAuthMonitoring();
  webSocketManager.disconnect();
});

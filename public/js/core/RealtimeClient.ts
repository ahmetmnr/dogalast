/**
 * OpenAI Realtime API Client
 * WebRTC-based real-time audio communication with OpenAI
 */

import { api } from './ApiClient.ts';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface RealtimeConfig {
  model: string;
  voice: string;
  sessionId: string;
  onAudioReceived: (audioData: ArrayBuffer) => void;
  onTranscriptReceived: (transcript: string, isFinal: boolean) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onError: (error: RealtimeError) => void;
}

interface RealtimeSession {
  id: string;
  model: string;
  voice: string;
  turn_detection: {
    type: 'server_vad';
    threshold: number;
    prefix_padding_ms: number;
    silence_duration_ms: number;
  };
  input_audio_format: 'pcm16';
  output_audio_format: 'pcm16';
  input_audio_transcription: {
    model: 'whisper-1';
  };
}

export type ConnectionState = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'reconnecting' 
  | 'failed';

export interface RealtimeError {
  code: string;
  message: string;
  recoverable: boolean;
  details?: any;
}

interface QueuedAudio {
  data: ArrayBuffer;
  timestamp: number;
}

// ============================================================================
// Realtime Client Class
// ============================================================================

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private config: RealtimeConfig;
  private connectionState: ConnectionState = 'disconnected';
  private ephemeralToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private sessionConfig: RealtimeSession | null = null;
  private audioQueue: QueuedAudio[] = [];
  private isProcessingAudio = false;
  private tokenRefreshTimer: number | null = null;

  constructor(config: RealtimeConfig) {
    this.config = config;
  }

  /**
   * Initialize connection to OpenAI Realtime API
   */
  async connect(): Promise<void> {
    try {
      this.setConnectionState('connecting');

      // Get ephemeral token from backend
      await this.refreshEphemeralToken();

      if (!this.ephemeralToken) {
        throw this.createError(
          'EPHEMERAL_TOKEN_FAILED',
          'Ephemeral token alınamadı',
          true
        );
      }

      // Establish WebSocket connection
      await this.establishWebSocketConnection();

      // Initialize session
      await this.initializeSession();

      this.setConnectionState('connected');
      this.reconnectAttempts = 0;

      console.log('OpenAI Realtime connection established');

    } catch (error) {
      console.error('Realtime connection failed:', error);
      this.setConnectionState('failed');

      if (error instanceof Error && this.isRecoverableError(error)) {
        await this.scheduleReconnect();
      } else {
        this.config.onError(error as RealtimeError);
      }
    }
  }

  /**
   * Disconnect from OpenAI Realtime API
   */
  async disconnect(): Promise<void> {
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection

    // Clear token refresh timer
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setConnectionState('disconnected');
    console.log('OpenAI Realtime connection closed');
  }

  /**
   * Send audio data to OpenAI
   */
  async sendAudio(audioData: ArrayBuffer): Promise<void> {
    if (this.connectionState !== 'connected' || !this.ws) {
      // Queue audio for later sending
      this.queueAudio(audioData);
      return;
    }

    try {
      // Convert ArrayBuffer to base64
      const base64Audio = this.arrayBufferToBase64(audioData);

      const message = {
        type: 'input_audio_buffer.append',
        audio: base64Audio
      };

      this.ws.send(JSON.stringify(message));

    } catch (error) {
      console.error('Failed to send audio:', error);
      this.queueAudio(audioData);
      
      this.config.onError(this.createError(
        'AUDIO_SEND_FAILED',
        'Ses verisi gönderilemedi',
        true,
        error
      ));
    }
  }

  /**
   * Commit audio buffer (trigger processing)
   */
  async commitAudio(): Promise<void> {
    if (this.connectionState !== 'connected' || !this.ws) {
      return;
    }

    const message = {
      type: 'input_audio_buffer.commit'
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Clear audio buffer
   */
  async clearAudio(): Promise<void> {
    if (this.connectionState !== 'connected' || !this.ws) {
      return;
    }

    const message = {
      type: 'input_audio_buffer.clear'
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send text message to trigger TTS response
   */
  async sendTextMessage(text: string): Promise<void> {
    if (this.connectionState !== 'connected' || !this.ws) {
      throw this.createError(
        'NOT_CONNECTED',
        'Realtime bağlantısı aktif değil',
        true
      );
    }

    try {
      const message = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: text
            }
          ]
        }
      };

      this.ws.send(JSON.stringify(message));

      // Trigger response generation
      const responseMessage = {
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions: 'Türkçe yanıt ver. Sıfır atık konusunda yardımcı ol. Kısa ve net cevaplar ver.'
        }
      };

      this.ws.send(JSON.stringify(responseMessage));

    } catch (error) {
      console.error('Failed to send text message:', error);
      throw this.createError(
        'TEXT_SEND_FAILED',
        'Metin mesajı gönderilemedi',
        true,
        error
      );
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected and ready
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Refresh ephemeral token from backend
   */
  private async refreshEphemeralToken(): Promise<void> {
    try {
      const response = await api.auth.getEphemeralToken(this.config.sessionId);

      if (response.success && response.data) {
        this.ephemeralToken = response.data.clientSecret;
        this.tokenExpiresAt = new Date(response.data.expiresAt).getTime();

        // Schedule token refresh at 75% of expiry time
        const now = Date.now();
        const refreshTime = (this.tokenExpiresAt - now) * 0.75;

        if (this.tokenRefreshTimer) {
          clearTimeout(this.tokenRefreshTimer);
        }

        this.tokenRefreshTimer = window.setTimeout(() => {
          if (this.connectionState === 'connected') {
            this.refreshEphemeralToken().catch(error => {
              console.error('Scheduled token refresh failed:', error);
            });
          }
        }, Math.max(refreshTime, 60000)); // Minimum 1 minute

        console.log('Ephemeral token refreshed, expires at:', new Date(this.tokenExpiresAt));

      } else {
        throw new Error(response.error?.message || 'Token refresh failed');
      }

    } catch (error) {
      console.error('Ephemeral token refresh failed:', error);
      throw this.createError(
        'TOKEN_REFRESH_FAILED',
        'Token yenilenemedi',
        true,
        error
      );
    }
  }

  /**
   * Establish WebSocket connection to OpenAI
   */
  private async establishWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `wss://api.openai.com/v1/realtime?model=${this.config.model}`;

      this.ws = new WebSocket(wsUrl);

      // Connection timeout
      const timeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.close();
          reject(this.createError(
            'CONNECTION_TIMEOUT',
            'Bağlantı zaman aşımına uğradı',
            true
          ));
        }
      }, 30000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        console.log('OpenAI WebSocket connection opened');

        // Send authorization
        if (this.ws && this.ephemeralToken) {
          this.ws.send(JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions: 'Sen Türkçe konuşan bir sıfır atık uzmanısın. Kısa ve net cevaplar ver.',
              voice: this.config.voice,
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16',
              input_audio_transcription: {
                model: 'whisper-1'
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500
              },
              tools: []
            }
          }));
        }

        resolve();
      };

      this.ws.onclose = (event) => {
        clearTimeout(timeout);
        console.log('OpenAI WebSocket connection closed:', event.code, event.reason);

        if (this.connectionState === 'connected') {
          this.setConnectionState('disconnected');
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        clearTimeout(timeout);
        console.error('OpenAI WebSocket error:', error);
        reject(this.createError(
          'WEBSOCKET_ERROR',
          'WebSocket bağlantı hatası',
          true,
          error
        ));
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };
    });
  }

  /**
   * Initialize OpenAI session with authentication
   */
  private async initializeSession(): Promise<void> {
    if (!this.ws || !this.ephemeralToken) {
      throw this.createError(
        'NO_WEBSOCKET_OR_TOKEN',
        'WebSocket bağlantısı veya token yok',
        true
      );
    }

    // Session is initialized in the onopen handler
    console.log('OpenAI session initialized');
  }

  /**
   * Handle incoming WebSocket messages from OpenAI
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'session.created':
          console.log('OpenAI session created:', message.session?.id);
          break;

        case 'session.updated':
          console.log('OpenAI session updated');
          break;

        case 'input_audio_buffer.speech_started':
          console.log('Speech started detected by server VAD');
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('Speech stopped detected by server VAD');
          break;

        case 'conversation.item.input_audio_transcription.completed':
          this.handleTranscriptionCompleted(message);
          break;

        case 'response.audio.delta':
          this.handleAudioDelta(message);
          break;

        case 'response.audio.done':
          this.handleAudioDone(message);
          break;

        case 'response.done':
          console.log('OpenAI response completed');
          break;

        case 'error':
          this.handleOpenAIError(message);
          break;

        default:
          if (__DEV__) {
            console.log('Unhandled OpenAI message type:', message.type);
          }
      }

    } catch (error) {
      console.error('Failed to parse OpenAI WebSocket message:', error);
    }
  }

  /**
   * Handle transcription completion from OpenAI
   */
  private handleTranscriptionCompleted(message: any): void {
    const transcript = message.transcript || '';
    console.log('OpenAI transcription completed:', transcript);

    this.config.onTranscriptReceived(transcript, true);
  }

  /**
   * Handle streaming audio delta from OpenAI
   */
  private handleAudioDelta(message: any): void {
    if (message.delta) {
      const audioData = this.base64ToArrayBuffer(message.delta);
      this.audioQueue.push({
        data: audioData,
        timestamp: Date.now()
      });

      if (!this.isProcessingAudio) {
        this.processAudioQueue();
      }
    }
  }

  /**
   * Handle audio completion from OpenAI
   */
  private handleAudioDone(message: any): void {
    console.log('OpenAI audio response completed');
    // Mark TTS end event here via backend API
  }

  /**
   * Handle OpenAI errors
   */
  private handleOpenAIError(message: any): void {
    console.error('OpenAI Realtime error:', message);

    const error = this.createError(
      message.error?.code || 'OPENAI_ERROR',
      message.error?.message || 'OpenAI hatası',
      true,
      message.error
    );

    this.config.onError(error);
  }

  /**
   * Process queued audio data
   */
  private async processAudioQueue(): Promise<void> {
    this.isProcessingAudio = true;

    while (this.audioQueue.length > 0) {
      const queuedAudio = this.audioQueue.shift()!;
      this.config.onAudioReceived(queuedAudio.data);

      // Small delay to prevent overwhelming the audio system
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.isProcessingAudio = false;
  }

  /**
   * Queue audio for later sending
   */
  private queueAudio(audioData: ArrayBuffer): void {
    // Keep only recent audio (last 5 seconds at 24kHz)
    const maxQueueSize = Math.floor((24000 * 5) / 4096); // Approximate

    this.audioQueue.push({
      data: audioData,
      timestamp: Date.now()
    });

    if (this.audioQueue.length > maxQueueSize) {
      this.audioQueue.shift();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setConnectionState('failed');
      this.config.onError(this.createError(
        'MAX_RECONNECT_ATTEMPTS',
        'Maksimum yeniden bağlanma denemesi aşıldı',
        false
      ));
      return;
    }

    this.reconnectAttempts++;
    this.setConnectionState('reconnecting');

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection attempt failed:', error);
      });
    }, delay);
  }

  /**
   * Set connection state and notify listeners
   */
  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.config.onConnectionStateChange(state);
    }
  }

  /**
   * Check if error is recoverable
   */
  private isRecoverableError(error: any): boolean {
    if (error && typeof error === 'object' && 'recoverable' in error) {
      return error.recoverable;
    }
    
    // Consider network errors recoverable
    return error.name === 'NetworkError' || error.code === 'NETWORK_ERROR';
  }

  /**
   * Create standardized error object
   */
  private createError(
    code: string,
    message: string,
    recoverable: boolean,
    details?: any
  ): RealtimeError {
    return {
      code,
      message,
      recoverable,
      details
    };
  }

  /**
   * Convert ArrayBuffer to base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

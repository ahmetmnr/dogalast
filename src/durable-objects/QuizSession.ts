/**
 * Durable Object for Quiz Session Management
 * Cloudflare Workers compatible WebSocket handling
 */

export interface Env {
  QUIZ_SESSION: DurableObjectNamespace;
  DB: D1Database;
  OPENAI_API_KEY: string;
  JWT_SECRET: string;
}

export class QuizSession {
  // private state: DurableObjectState; // Unused for now
  private env: Env;
  private sessions: Map<WebSocket, any> = new Map();

  constructor(_state: DurableObjectState, env: Env) {
    // this.state = state; // Unused for now
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept WebSocket connection
    if (server) {
      server.accept();
    }

    // Get token from URL
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      // Verify JWT token (simplified for now)
      const userId = this.extractUserIdFromToken(token);
      
      // Store session info
      if (server) {
        this.sessions.set(server, {
          userId,
          token,
          connectedAt: new Date(),
          openaiConnection: null
        });

        // Setup WebSocket handlers
        server.addEventListener('message', async (event) => {
          await this.handleWebSocketMessage(server, event.data);
        });

        server.addEventListener('close', () => {
          this.handleWebSocketClose(server);
        });
      }

      // Send welcome message
      if (server) {
        server.send(JSON.stringify({
          type: 'connection_established',
          data: {
            userId,
            timestamp: new Date().toISOString(),
            message: 'Durable Object WebSocket bağlantısı kuruldu'
          }
        }));
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });

    } catch (error) {
      return new Response('Token verification failed', { status: 401 });
    }
  }

  private async handleWebSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session) return;

    try {
      // Handle both string and binary messages
      let data: any;
      
      if (typeof message === 'string') {
        data = JSON.parse(message);
      } else {
        // Binary message (PCM16 audio)
        console.log('📡 Binary audio data received:', message.byteLength, 'bytes');
        // Convert to base64 for OpenAI
        const base64Audio = this.arrayBufferToBase64(message);
        data = {
          type: 'input_audio_buffer.append',
          audio: base64Audio
        };
      }

      console.log('📨 Message from user', session.userId, ':', data.type);

      // Forward to OpenAI if needed
      switch (data.type) {
        case 'session.update':
        case 'conversation.item.create':
        case 'response.create':
        case 'input_audio_buffer.append':
        case 'input_audio_buffer.commit':
        case 'input_audio_buffer.clear':
          await this.forwardToOpenAI(session, data);
          break;

        case 'ping':
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString()
          }));
          break;

        default:
          console.log('🔄 Echo message:', data.type);
          ws.send(JSON.stringify({
            type: 'echo',
            data: data,
            timestamp: new Date().toISOString()
          }));
      }

    } catch (error) {
      console.error('Message handling error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: {
          code: 'MESSAGE_PROCESSING_FAILED',
          message: 'Mesaj işlenemedi'
        }
      }));
    }
  }

  private async forwardToOpenAI(session: any, data: any): Promise<void> {
    try {
      // Create OpenAI connection if not exists
      if (!session.openaiConnection) {
        await this.createOpenAIConnection(session);
      }

      // Forward message to OpenAI
      if (session.openaiConnection && session.openaiConnection.readyState === WebSocket.OPEN) {
        session.openaiConnection.send(JSON.stringify(data));
        console.log('✅ Forwarded to OpenAI:', data.type);
      } else {
        console.warn('⚠️ OpenAI connection not ready');
      }

    } catch (error) {
      console.error('OpenAI forward error:', error);
    }
  }

  private async createOpenAIConnection(session: any): Promise<void> {
    try {
      // Create ephemeral token
      const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'realtime=v1'
        },
        body: JSON.stringify({
          model: 'gpt-4o-realtime-preview-2025-06-03',
          voice: 'alloy'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create OpenAI session');
      }

      // const data = await response.json() as any;
      // const _ephemeralToken = data.client_secret.value; // Not needed for WebSocket

      // Create WebSocket connection to OpenAI
      const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03');

      session.openaiConnection = openaiWs;

      openaiWs.addEventListener('message', (event) => {
        // Forward OpenAI response back to client
        const clientWs = this.getClientWebSocket(session.userId);
        if (clientWs) {
          clientWs.send(event.data);
        }
      });

      openaiWs.addEventListener('close', () => {
        console.log('🔌 OpenAI connection closed for user', session.userId);
        session.openaiConnection = null;
      });

      console.log('✅ OpenAI connection created for user', session.userId);

    } catch (error) {
      console.error('Failed to create OpenAI connection:', error);
    }
  }

  private handleWebSocketClose(ws: WebSocket): void {
    const session = this.sessions.get(ws);
    if (session) {
      console.log('🔌 User disconnected:', session.userId);
      
      // Close OpenAI connection
      if (session.openaiConnection) {
        session.openaiConnection.close();
      }
      
      this.sessions.delete(ws);
    }
  }

  private getClientWebSocket(userId: string): WebSocket | null {
    for (const [ws, session] of this.sessions) {
      if (session.userId === userId) {
        return ws;
      }
    }
    return null;
  }

  private extractUserIdFromToken(token: string): string {
    // Simplified JWT decode (in production, use proper JWT verification)
    try {
      const parts = token.split('.');
      if (parts.length < 2 || !parts[1]) return 'unknown';
      const payload = JSON.parse(atob(parts[1]));
      return payload.sub || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i] as number);
    }
    return btoa(binary);
  }
}

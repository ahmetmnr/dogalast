import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'

// Environment and config
import { env, createLogger, isDevelopment } from '@/config/environment'

// Database connection
import { createDatabaseConnection } from '@/db/connection'

// Middleware
import { performanceMiddleware } from '@/utils/dev-tools'

// Routes
import { authRoutes } from '@/routes/auth'
import { quizRoutes } from '@/routes/quiz'
import { adminRoutes } from '@/routes/admin'
import { websocketRoutes } from '@/routes/websocket'

// Types
import type { ContextVariables } from '@/types/api'

const appLogger = createLogger('app')

// Create Hono app with proper typing
const app = new Hono<{ Variables: ContextVariables }>()

// Global middleware
app.use('*', logger())
app.use('*', prettyJSON())
app.use('*', secureHeaders())

if (isDevelopment) {
  app.use('*', performanceMiddleware())
}

// CORS configuration
app.use('*', cors({
  origin: isDevelopment ? ['http://localhost:3000', 'http://localhost:8787'] : ['https://quiz.sifiratiketkinligi.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}))

// Database middleware - inject DB into context
app.use('*', async (c, next) => {
  try {
    const db = createDatabaseConnection(c.env)
    c.set('db', db)
    await next()
  } catch (error) {
    appLogger.error('Database connection failed:', error as Error)
    return c.json({
      success: false,
      error: {
        code: 'DATABASE_CONNECTION_FAILED',
        message: 'Database connection failed'
      },
      timestamp: new Date().toISOString()
    }, 500)
  }
  return
})

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      version: '1.0.0'
    }
  })
})

// API Routes
app.route('/api/auth', authRoutes)
app.route('/api/quiz', quizRoutes)
app.route('/api/admin', adminRoutes)

// WebSocket route (at root level)
app.route('/', websocketRoutes)

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found'
    },
    timestamp: new Date().toISOString()
  }, 404)
})

// Global error handler
app.onError((error, c) => {
  appLogger.error('Unhandled error:', error)
  
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isDevelopment ? error.message : 'Internal server error'
    },
    timestamp: new Date().toISOString()
  }, 500)
})

// Utility function for binary audio conversion
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

appLogger.info('Zero Waste Quiz application started successfully')

// Bun server configuration with WebSocket support
export default {
  port: env.PORT,
  fetch(req: Request, server: any) {
    const url = new URL(req.url);
    
    // Handle WebSocket upgrade for /ws endpoint
    if (url.pathname === '/ws' && req.headers.get('upgrade') === 'websocket') {
      const token = url.searchParams.get('token');
      
      if (!token) {
        return new Response('Unauthorized', { status: 401 });
      }

      // Upgrade to WebSocket
      const success = server.upgrade(req, {
        data: { token, userId: 'extracted-from-token' }
      });
      
      if (success) {
        return undefined; // WebSocket upgrade successful
      }
      
      return new Response('WebSocket upgrade failed', { status: 426 });
    }
    
    // Handle regular HTTP requests
    return app.fetch(req, server);
  },
  websocket: {
    message(ws: any, message: string | ArrayBuffer) {
      try {
        let data: any;
        
        // Handle both string (JSON) and binary (PCM16) messages
        if (typeof message === 'string') {
          data = JSON.parse(message);
          appLogger.info(`[websocket] JSON message from ${ws.data?.userId}:`, data.type);
        } else {
          // Binary PCM16 audio data
          appLogger.info(`[websocket] Binary audio from ${ws.data?.userId}:`, message.byteLength, 'bytes');
          
          // Convert to base64 for OpenAI
          const base64Audio = arrayBufferToBase64(message);
          data = {
            type: 'input_audio_buffer.append',
            audio: base64Audio
          };
        }
        
        // Handle different message types
        switch (data.type) {
          case 'ping':
            ws.send(JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString()
            }));
            break;
            
          case 'session.update':
          case 'conversation.item.create':
          case 'response.create':
          case 'input_audio_buffer.append':
          case 'input_audio_buffer.commit':
          case 'input_audio_buffer.clear':
            // Forward OpenAI Realtime API messages
            if (ws.openaiConnection && ws.openaiConnection.readyState === WebSocket.OPEN) {
              ws.openaiConnection.send(JSON.stringify(data));
              appLogger.info(`[websocket] Forwarded ${data.type} to OpenAI`);
            } else {
              appLogger.warn(`[websocket] OpenAI connection not ready for ${data.type}`);
              // Send fallback response
              ws.send(JSON.stringify({
                type: 'error',
                error: {
                  code: 'OPENAI_NOT_CONNECTED',
                  message: 'OpenAI bağlantısı aktif değil'
                }
              }));
            }
            break;
            
          case 'leaderboard_request':
            ws.send(JSON.stringify({
              type: 'leaderboard_update',
              data: { message: 'Liderlik tablosu güncellendi' },
              timestamp: new Date().toISOString()
            }));
            break;
            
          default:
            // Forward unknown messages to OpenAI
            if (ws.openaiConnection && ws.openaiConnection.readyState === WebSocket.OPEN) {
              ws.openaiConnection.send(JSON.stringify(data));
            } else {
              ws.send(JSON.stringify({
                type: 'echo',
                data: data,
                timestamp: new Date().toISOString()
              }));
            }
        }
      } catch (error) {
        appLogger.error('[websocket] Message parse error:', error);
      }
    },
    async open(ws: any) {
      const userId = ws.data?.userId || 'unknown';
      appLogger.info(`[websocket] Connection opened for user ${userId}`);
      
      // Create OpenAI Realtime connection for this user
      try {
        // Debug API key
        const apiKey = process.env['OPENAI_API_KEY'];
        appLogger.info(`[websocket] OpenAI API Key check:`, {
          present: !!apiKey,
          length: apiKey?.length || 0,
          prefix: apiKey?.substring(0, 7) || 'none'
        });
        
        if (!apiKey) {
          throw new Error('OPENAI_API_KEY not found in environment');
        }
        
        // Use fetch to create OpenAI session first, then connect
        const sessionResponse = await fetch('https://api.openai.com/v1/realtime/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'realtime=v1'
          },
          body: JSON.stringify({
            model: 'gpt-4o-realtime-preview-2025-06-03',
            voice: 'alloy'
          })
        });
        
        if (!sessionResponse.ok) {
          throw new Error('Failed to create OpenAI session');
        }
        
        const sessionData = await sessionResponse.json() as any;
        const ephemeralToken = sessionData.client_secret.value;
        
        // Now connect with ephemeral token
        const openaiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03`, [], {
          headers: {
            'Authorization': `Bearer ${ephemeralToken}`,
            'OpenAI-Beta': 'realtime=v1'
          }
        });
        
        ws.openaiConnection = openaiWs;
        
        openaiWs.onopen = () => {
          appLogger.info(`[websocket] OpenAI connection established for user ${userId}`);
          
          // Configure OpenAI session with quiz-specific instructions
          openaiWs.send(JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions: `Sen bir sıfır atık yarışması asistanısın. Görevin:
1. Kullanıcıya soruları net ve anlaşılır Türkçe ile okumak
2. Kullanıcının sesli cevaplarını dinlemek ve değerlendirmek
3. Doğru/yanlış feedback vermek
4. Yarışma skorunu takip etmek

Şu anda aktif soru var. Kullanıcı "soruyu oku" dediğinde mevcut soruyu sesli olarak oku.`,
              voice: 'alloy',
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16',
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
                create_response: true,
                interrupt_response: true
              },
              tools: [
                {
                  type: "function",
                  name: "read_current_question",
                  description: "Mevcut aktif soruyu sesli olarak oku",
                  parameters: {
                    type: "object",
                    properties: {},
                    additionalProperties: false
                  }
                },
                {
                  type: "function", 
                  name: "evaluate_answer",
                  description: "Kullanıcının cevabını değerlendir ve puan ver",
                  parameters: {
                    type: "object",
                    properties: {
                      answer: { type: "string", description: "Kullanıcının cevabı" },
                      isCorrect: { type: "boolean", description: "Cevap doğru mu" },
                      points: { type: "number", description: "Kazanılan puan" }
                    },
                    required: ["answer", "isCorrect", "points"]
                  }
                }
              ]
            }
          }));
          
          // Immediately ask OpenAI to read the current question
          setTimeout(() => {
            openaiWs.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [{
                  type: 'input_text',
                  text: 'Mevcut soruyu sesli olarak oku lütfen.'
                }]
              }
            }));
            
            openaiWs.send(JSON.stringify({
              type: 'response.create',
              response: { modalities: ['text', 'audio'] }
            }));
          }, 1000);
        };
        
        openaiWs.onmessage = (event) => {
          // Parse OpenAI message for timing events
          try {
            const openaiData = JSON.parse(event.data);
            
            // Record timing events
            switch (openaiData.type) {
              case 'response.audio.delta':
                console.log('🔊 TTS audio chunk');
                break;
                
              case 'response.audio.done':
                console.log('🔊 TTS completed - should record timing');
                break;
                
              case 'input_audio_buffer.speech_started':
                console.log('🎤 User speech started - should record timing');
                break;
                
              case 'conversation.item.input_audio_transcription.completed':
                console.log('📝 Answer transcribed - should record timing');
                break;
            }
          } catch (error) {
            // Not JSON, might be binary
          }
          
          // Forward OpenAI messages to client
          ws.send(event.data);
        };
        
        openaiWs.onclose = () => {
          appLogger.info(`[websocket] OpenAI connection closed for user ${userId}`);
        };
        
      } catch (error) {
        appLogger.error(`[websocket] Failed to create OpenAI connection for user ${userId}:`, error);
      }
      
      ws.send(JSON.stringify({
        type: 'connection_established',
        data: {
          userId: userId,
          timestamp: new Date().toISOString(),
          message: 'WebSocket bağlantısı başarıyla kuruldu'
        }
      }));
    },
    close(ws: any, code: number, reason: string) {
      appLogger.info(`[websocket] Connection closed for ${ws.data?.userId}:`, code, reason);
    },
    error(ws: any, error: Error) {
      appLogger.error(`[websocket] Error for ${ws.data?.userId}:`, error);
    }
  }
}
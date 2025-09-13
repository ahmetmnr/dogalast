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
import { leaderboardRoutes } from '@/routes/leaderboard'
import { SecureToolHandler } from '@/services/SecureToolHandler'
import { participants } from '@/db/schema'
import { eq } from 'drizzle-orm'

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
app.route('/api', leaderboardRoutes)

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
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

// OpenAI tool çağrılarını handle eden fonksiyon
async function handleOpenAIToolCall(message: any, ws: any, userId: string) {
  try {
    if (message.type === 'response.function_call_done') {
      const toolCall = message.function_call;
      const toolName = toolCall.name;
      const toolArgs = JSON.parse(toolCall.arguments || '{}');
      
      appLogger.info(`[openai-tool] User ${userId} calling tool: ${toolName}`, toolArgs);
      
      // Backend tool dispatch'e yönlendir
      const toolResult = await executeToolForOpenAI(toolName, toolArgs, userId);
      
      // Sonucu OpenAI'ya gönder
      if (ws.openaiConnection && ws.openaiConnection.readyState === WebSocket.OPEN) {
        ws.openaiConnection.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: JSON.stringify(toolResult)
          }
        }));
      }
      
      // Frontend'e de bildir
      ws.send(JSON.stringify({
        type: 'tool_execution_result',
        tool: toolName,
        args: toolArgs,
        result: toolResult,
        timestamp: new Date().toISOString()
      }));
    }
  } catch (error) {
    appLogger.error('[openai-tool] Tool execution error:', error);
  }
}

// OpenAI için tool execution
async function executeToolForOpenAI(toolName: string, args: any, userId: string) {
  try {
    // Database connection
    const db = createDatabaseConnection(env);
    
    // User bilgisini al
    const user = await getUserById(db, userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    // SecureToolHandler ile tool'u çalıştır
    const toolHandler = new SecureToolHandler(db, user);
    
    // Tool execution
    const result = await toolHandler.executeTool(toolName, args, args.sessionId);
    
    appLogger.info(`[openai-tool] Tool ${toolName} executed successfully:`, result);
    
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    appLogger.error(`[openai-tool] Tool ${toolName} execution failed:`, error);
    
    return {
      success: false,
      error: {
        code: (error as any).code || 'TOOL_EXECUTION_FAILED',
        message: (error as any).message || 'Tool execution failed'
      },
      timestamp: new Date().toISOString()
    };
  }
}

// User bilgisini ID ile getiren helper fonksiyon
async function getUserById(db: any, userId: string) {
  try {
    const parsedUserId = parseInt(userId);
    if (isNaN(parsedUserId)) {
      throw new Error('Invalid user ID format');
    }
    
    const users = await db.select().from(participants).where(eq(participants.id, parsedUserId));
    return users[0] || null;
  } catch (error) {
    appLogger.error('Failed to get user by ID:', error);
    return null;
  }
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
                type: 'server_error',
                payload: {
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
        
        // Now connect with ephemeral token (no headers in WebSocket constructor)
        const openaiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03`);
        
        ws.openaiConnection = openaiWs;
        
        openaiWs.onopen = () => {
          appLogger.info(`[websocket] OpenAI connection established for user ${userId}`);
          
          // Send authorization first
          openaiWs.send(JSON.stringify({
            type: 'session.update',
            session: {
              authorization: `Bearer ${ephemeralToken}`,
              modalities: ['text', 'audio'],
              instructions: `Sen bir sıfır atık yarışması asistanısın. Görevlerin:

1. SORU OKUMA: Kullanıcıya soruları net ve anlaşılır Türkçe ile oku
2. CEVAP ALMA: Kullanıcının sesli cevabını dinle ve anla
3. TOOL ÇAĞIRMA: Her işlem için uygun tool'u çağır
4. YARIŞMA TAKİBİ: Skor, soru numarası, ilerleme takibi yap

YARIŞMA AKIŞI:
- Kullanıcı "yarışmaya başla" derse: startQuiz tool'unu çağır
- Kullanıcı cevap verince: submitAnswer tool'unu çağır
- Soru bitince: nextQuestion tool'unu çağır
- 10 soru bitince: finishQuiz tool'unu çağır

KURALLAR:
- Her işlemde mutlaka ilgili tool'u çağır
- Skor ve ilerleme bilgisini sürekli güncelle
- Kullanıcıya cesaretlendirici geri bildirim ver
- Sıfır atık konusunda bilgi ver`,
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
                  type: 'function',
                  name: 'startQuiz',
                  description: 'Yarışmayı başlatır ve ilk soruyu getirir',
                  parameters: {
                    type: 'object',
                    properties: {
                      sessionId: {
                        type: 'string',
                        description: 'Mevcut session ID (opsiyonel)'
                      }
                    }
                  }
                },
                {
                  type: 'function',
                  name: 'submitAnswer',
                  description: 'Kullanıcının cevabını değerlendirir ve puanlar',
                  parameters: {
                    type: 'object',
                    properties: {
                      sessionQuestionId: {
                        type: 'string', 
                        description: 'Mevcut soru session ID'
                      },
                      userAnswer: {
                        type: 'string',
                        description: 'Kullanıcının verdiği cevap'
                      },
                      confidence: {
                        type: 'number',
                        description: 'Cevap güven skoru (0-1)'
                      }
                    },
                    required: ['sessionQuestionId', 'userAnswer']
                  }
                },
                {
                  type: 'function',
                  name: 'nextQuestion',
                  description: 'Sonraki soruya geçer',
                  parameters: {
                    type: 'object',
                    properties: {
                      sessionId: {
                        type: 'string',
                        description: 'Yarışma session ID'
                      }
                    },
                    required: ['sessionId']
                  }
                },
                {
                  type: 'function',
                  name: 'finishQuiz',
                  description: 'Yarışmayı bitirir ve sonuçları gösterir',
                  parameters: {
                    type: 'object',
                    properties: {
                      sessionId: {
                        type: 'string',
                        description: 'Yarışma session ID'
                      }
                    },
                    required: ['sessionId']
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
        
        // OpenAI'dan gelen mesajları handle et
        openaiWs.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data);
            
            // Tool çağrılarını handle et
            if (message.type === 'response.function_call_delta' || message.type === 'response.function_call_done') {
              await handleOpenAIToolCall(message, ws, userId);
            }
            
            // Timing events için log
            if (['response.audio.delta', 'response.audio.done', 'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped'].includes(message.type)) {
              appLogger.info(`[websocket] OpenAI timing event: ${message.type}`);
            }
            
            // Diğer mesajları frontend'e forward et
            ws.send(event.data);
            
          } catch (error) {
            appLogger.error('[websocket] OpenAI message handling error:', error);
          }
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
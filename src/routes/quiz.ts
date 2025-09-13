import { Hono } from 'hono'
import { PromptBuilder } from '@/services/PromptBuilder'

// Services
import { SecureToolHandler } from '@/services/SecureToolHandler'

// Middleware
import { ValidationMiddleware, schemas } from '@/middleware/validation'
import { AuthMiddleware, getAuthenticatedUser } from '@/middleware/auth'

// Types
import type { AppContext, ToolDispatchRequest } from '@/types/api'
import { ErrorCode, AppError } from '@/types/errors'

// Utils
import { createLogger } from '@/config/environment'

const logger = createLogger('quiz-routes')

// Create router
const router = new Hono<{ Variables: any }>()

// Tool dispatch endpoint
router.post(
  '/tools/dispatch',
  new AuthMiddleware().authenticate(),
  ValidationMiddleware.validateBody(schemas.toolDispatch),
  async (c: AppContext) => {
    try {
      const user = getAuthenticatedUser(c)
      const validatedBody = c.get('validatedBody') as ToolDispatchRequest
      const db = c.get('db')

      const toolHandler = new SecureToolHandler(db, user)
      
      const result = await toolHandler.executeTool(
        validatedBody.tool,
        validatedBody.args,
        validatedBody.sessionId
      )

      return c.json({
        success: true,
        data: result,
        timing: {
          serverTimestamp: Date.now(),
          processingTime: 0 // Will be calculated by middleware
        },
        timestamp: new Date().toISOString()
      })

    } catch (error) {
      logger.error('Tool dispatch failed:', error)
      
      if (error instanceof AppError) {
        return c.json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          },
          timestamp: new Date().toISOString()
        }, error.statusCode as any)
      }

      return c.json({
        success: false,
        error: {
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: 'Tool execution failed'
        },
        timestamp: new Date().toISOString()
      }, 500)
    }
  }
)
// Export router
// Ephemeral token endpoint for OpenAI Realtime API
router.post('/realtime/ephemeral-token', async (c: AppContext) => {
  try {
    const sessionId = c.req.query('sessionId')
    if (!sessionId) {
      return c.json({ success: false, error: { code: 'MISSING_SESSION_ID', message: 'Session ID required' } }, 400)
    }
    
    // Call OpenAI API to create ephemeral token
    const openaiApiKey = process.env['OPENAI_API_KEY']
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured')
    }

    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
          body: JSON.stringify({
            model: 'gpt-4o-realtime-preview-2025-06-03',
            voice: 'alloy',
            instructions: PromptBuilder.buildSystemInstructions(),
            modalities: ['text', 'audio'],
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
            tools: PromptBuilder.getToolsSchema()
          })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('OpenAI API error:', error)
      throw new Error('Failed to create ephemeral token')
    }

    const data = await response.json() as any
    console.log('OpenAI API response:', JSON.stringify(data, null, 2))
    
    return c.json({
      success: true,
      data: {
        token: data.client_secret?.value || data.token || 'fallback-token',
        sessionId,
        expiresIn: data.client_secret?.expires_at ? (data.client_secret.expires_at - Math.floor(Date.now() / 1000)) : 3600
      }
    })
  } catch (error) {
    console.error('Token generation error:', error)
    return c.json({ 
      success: false, 
      error: { 
        code: 'TOKEN_ERROR', 
        message: error instanceof Error ? error.message : 'Failed to generate token' 
      } 
    }, 500)
  }
})

// OpenAI Realtime API WebSocket proxy (optional)
router.get('/realtime/proxy', async (c) => {
  const upgrade = c.req.header('upgrade');
  if (upgrade !== 'websocket') {
    return c.text('Expected websocket', 400);
  }
  
  const { searchParams } = new URL(c.req.url);
  const model = searchParams.get('model') || 'gpt-4o-realtime-preview-2025-06-03';
  
  const env = c.env as any;
  const openaiApiKey = env?.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    return c.text('OpenAI API key not configured', 500);
  }
  
  try {
    // Create WebSocket pair
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    // Accept client connection
    if (server) {
      server.accept();
    }
    
    // Create OpenAI WebSocket connection
    const openaiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`);
    
    // Forward messages from client to OpenAI
    if (server) {
      server.addEventListener('message', (event) => {
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(event.data);
        }
      });
      
      server.addEventListener('close', () => {
        openaiWs.close();
      });
    }
    
    // Forward messages from OpenAI to client
    openaiWs.addEventListener('message', (event) => {
      if (server && server.readyState === WebSocket.OPEN) {
        server.send(event.data);
      }
    });
    
    openaiWs.addEventListener('close', () => {
      if (server) {
        server.close();
      }
    });
    
    openaiWs.addEventListener('error', (error) => {
      console.error('OpenAI WebSocket error:', error);
      if (server) {
        server.close();
      }
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
    
  } catch (error) {
    console.error('WebSocket proxy error:', error);
    return c.text('Failed to create proxy connection', 500);
  }
})

export { router as quizRoutes }
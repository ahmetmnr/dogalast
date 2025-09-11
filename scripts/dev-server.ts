#!/usr/bin/env bun

import { $ } from 'bun'
import { createLogger } from '../src/config/environment'

const logger = createLogger('dev-server')

async function startDevServers() {
  logger.info('🚀 Starting development servers...')
  
  try {
    // Start backend with hot reload
    logger.info('🔥 Starting backend server with hot reload...')
    const backend = Bun.spawn(['bun', 'run', '--hot', 'src/index.ts'], {
      env: { 
        ...process.env, 
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug'
      },
      stdio: ['inherit', 'inherit', 'inherit']
    })
    
    // Wait a bit for backend to start
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Start frontend dev server
    logger.info('⚡ Starting frontend development server...')
    const frontend = Bun.spawn(['bun', 'run', 'dev:frontend'], {
      stdio: ['inherit', 'inherit', 'inherit']
    })
    
    logger.info('✅ Development servers started successfully!')
    logger.info('🌐 Backend server: http://localhost:8787')
    logger.info('🎨 Frontend server: http://localhost:3000')
    logger.info('🔄 Hot reload enabled for both servers')
    logger.info('🛑 Press Ctrl+C to stop servers')
    
    // Handle graceful shutdown
    const shutdown = () => {
      logger.info('\n🛑 Shutting down development servers...')
      backend.kill()
      frontend.kill()
      process.exit(0)
    }
    
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    
    // Wait for processes
    await Promise.race([backend.exited, frontend.exited])
    
  } catch (error) {
    logger.error('❌ Failed to start development servers:', error)
    process.exit(1)
  }
}

startDevServers()

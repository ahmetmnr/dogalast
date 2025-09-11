#!/usr/bin/env bun

import { $ } from 'bun'
import { existsSync, rmSync, mkdirSync } from 'fs'
import { createLogger } from '../src/config/environment'

const logger = createLogger('build')

async function buildProduction() {
  logger.info('🏗️ Starting production build...')
  
  try {
    // Clean dist directory
    if (existsSync('dist')) {
      rmSync('dist', { recursive: true })
      logger.info('✅ Cleaned dist directory')
    }
    
    mkdirSync('dist', { recursive: true })
    
    // Type check
    logger.info('🔍 Running type check...')
    await $`bun run type-check`
    logger.info('✅ Type check passed')
    
    // Lint check
    logger.info('🔍 Running lint check...')
    await $`bun run lint`
    logger.info('✅ Lint check passed')
    
    // Build backend
    logger.info('🏗️ Building backend...')
    await $`bun build src/index.ts --outdir dist --target bun --minify --sourcemap --external @cloudflare/workers-types`
    logger.info('✅ Backend build completed')
    
    // Build frontend
    logger.info('🏗️ Building frontend...')
    await $`bun run build:frontend`
    logger.info('✅ Frontend build completed')
    
    // Copy static assets
    logger.info('📁 Copying static assets...')
    if (existsSync('public')) {
      await $`cp -r public dist/public`
      logger.info('✅ Static assets copied')
    }
    
    // Generate build info
    const buildInfo = {
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.1',
      commit: await $`git rev-parse HEAD`.text().catch(() => 'unknown'),
      branch: await $`git branch --show-current`.text().catch(() => 'unknown'),
      nodeVersion: process.version,
      bunVersion: await $`bun --version`.text().catch(() => 'unknown')
    }
    
    await Bun.write('dist/build-info.json', JSON.stringify(buildInfo, null, 2))
    logger.info('✅ Build info generated')
    
    // Bundle size analysis
    const stats = await $`du -sh dist/`.text()
    logger.info(`📦 Bundle size: ${stats.trim()}`)
    
    logger.info('🎉 Production build completed successfully!')
    
  } catch (error) {
    logger.error('❌ Build failed:', error)
    process.exit(1)
  }
}

buildProduction()

#!/bin/bash

# Zero Waste Quiz - Production Deployment Script
# Bu script projeyi Cloudflare Workers'a deploy eder

set -e

echo "🚀 Starting Zero Waste Quiz Production Deployment..."

# 1. Environment check
echo "📋 Checking environment..."
if [ ! -f "wrangler.toml" ]; then
    echo "❌ wrangler.toml not found!"
    exit 1
fi

if [ ! -f ".env.production" ]; then
    echo "❌ .env.production not found!"
    exit 1
fi

# 2. Install dependencies
echo "📦 Installing dependencies..."
bun install

# 3. Type check
echo "🔍 Running type check..."
bun run type-check

# 4. Build project
echo "🏗️ Building project..."
bun run build:production

# 5. Database setup
echo "🗄️ Setting up database..."
bun run db:setup:production

# 6. Run migrations
echo "📊 Running database migrations..."
bun run db:migrate:production

# 7. Seed database
echo "🌱 Seeding database..."
bun run db:seed:production

# 8. Deploy to Cloudflare Workers
echo "☁️ Deploying to Cloudflare Workers..."
bun run deploy:prod

echo "✅ Deployment completed successfully!"
echo "🌐 Your app is live at: https://zero-waste-quiz.your-domain.com"


#!/bin/bash

# Production Secrets Push Script
# Bu script environment variable'ları Cloudflare Workers'a yükler

set -e

echo "🔐 Pushing production secrets to Cloudflare Workers..."

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    echo "❌ .env.production file not found!"
    echo "📝 Please create .env.production from env.production.example"
    exit 1
fi

# Load environment variables
source .env.production

# Push secrets to Cloudflare Workers
echo "📤 Uploading secrets..."

# OpenAI Configuration
echo "$OPENAI_API_KEY" | npx wrangler secret put OPENAI_API_KEY --env production
echo "$OPENAI_REALTIME_MODEL" | npx wrangler secret put OPENAI_REALTIME_MODEL --env production

# Security secrets
echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET --env production
echo "$ADMIN_PASSWORD_HASH" | npx wrangler secret put ADMIN_PASSWORD_HASH --env production

# Database secrets (if needed)
if [ ! -z "$DB_AUTH_TOKEN" ]; then
    echo "$DB_AUTH_TOKEN" | npx wrangler secret put DB_AUTH_TOKEN --env production
fi

# Cloudflare API tokens (if needed)
if [ ! -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "$CLOUDFLARE_API_TOKEN" | npx wrangler secret put CLOUDFLARE_API_TOKEN --env production
fi

echo "✅ All secrets uploaded successfully!"
echo "🔍 Verify with: npx wrangler secret list --env production"

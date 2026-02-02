#!/bin/bash

# Script to start recall locally using Railway Redis and Supabase
# This will set up Railway Redis tunnel and start the application

set -e

echo "🚀 Starting Recall with Railway Redis and Supabase..."
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found!"
    echo "   Install it with: npm i -g @railway/cli"
    echo "   Then run: railway login"
    exit 1
fi

# Check if logged in to Railway
if ! railway whoami &> /dev/null; then
    echo "⚠️  Not logged in to Railway"
    echo "   Run: railway login"
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "   The .env file should already be configured with Railway Redis URL"
    exit 1
fi

echo "📋 Current configuration:"
echo "   DATABASE_URL: $(grep DATABASE_URL .env | cut -d'=' -f2 | cut -d'@' -f2 | cut -d'/' -f1)"
echo "   REDIS_URL: $(grep REDIS_URL .env | cut -d'@' -f2)"
echo ""

# Check if Redis URL is Railway internal
if grep -q "redis.railway.internal" .env; then
    echo "⚠️  Railway Redis uses internal domain (redis.railway.internal)"
    echo "   This won't work from localhost without a tunnel."
    echo ""
    echo "   Option 1: Use Railway CLI tunnel (recommended)"
    echo "     Run in a separate terminal: railway connect redis"
    echo "     This will create a local tunnel"
    echo ""
    echo "   Option 2: Get public Redis URL from Railway dashboard"
    echo "     Go to Railway -> Redis service -> Connect -> Copy Public URL"
    echo "     Update REDIS_URL in .env with the public hostname"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo ""
echo "🚀 Starting Recall..."
echo ""
echo "📌 You need TWO terminal windows:"
echo ""
echo "Terminal 1 - Main Server:"
echo "   npm run dev"
echo ""
echo "Terminal 2 - Worker:"
echo "   npm run dev:worker"
echo ""
echo "If Railway Redis tunnel is needed, run in Terminal 3:"
echo "   railway connect redis"
echo ""
read -p "Start server now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run dev
fi

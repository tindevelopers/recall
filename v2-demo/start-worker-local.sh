#!/bin/bash
# Start worker with proper logging
set -e

echo "🚀 Starting v2-demo worker locally..."
echo ""

# Check Redis
if ! (echo "PING" | nc -w 1 localhost 6379 &>/dev/null 2>&1); then
    echo "⚠️  Redis is not running on localhost:6379"
    echo ""
    echo "📦 Attempting to start Redis..."
    
    # Try Docker first
    if command -v docker &> /dev/null && docker ps &> /dev/null 2>&1; then
        echo "   Using Docker..."
        docker run -d --name redis-local -p 6379:6379 redis:6.2-alpine 2>/dev/null || docker start redis-local 2>/dev/null
        sleep 2
    # Try brew services
    elif command -v brew &> /dev/null && brew services list | grep -q redis; then
        echo "   Using Homebrew services..."
        brew services start redis
        sleep 2
    # Try redis-server directly
    elif command -v redis-server &> /dev/null; then
        echo "   Starting redis-server..."
        redis-server --daemonize yes --port 6379
        sleep 2
    else
        echo ""
        echo "❌ Redis is not available. Please install and start Redis:"
        echo ""
        echo "   Option 1 (Homebrew):"
        echo "     brew install redis"
        echo "     brew services start redis"
        echo ""
        echo "   Option 2 (Docker):"
        echo "     docker run -d --name redis-local -p 6379:6379 redis:6.2-alpine"
        echo ""
        exit 1
    fi
    
    # Verify Redis started
    if ! (echo "PING" | nc -w 1 localhost 6379 &>/dev/null 2>&1); then
        echo "❌ Failed to start Redis. Please start Redis manually."
        exit 1
    fi
fi

echo "✅ Redis is running on localhost:6379"
echo ""

# Load environment
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Override REDIS_URL to use 127.0.0.1 (more reliable than localhost)
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
# Ensure we use local Redis even if .env has different URL
export REDIS_URL="redis://127.0.0.1:6379"

# Start worker with enhanced logging
echo "📋 Starting worker process..."
echo "   NODE_ENV: ${NODE_ENV:-development}"
echo "   REDIS_URL: ${REDIS_URL}"
echo ""

NODE_ENV=${NODE_ENV:-development} npm run start:worker

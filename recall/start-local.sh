#!/bin/bash

# Helper script to start recall locally
# This will check prerequisites and start both server and worker

set -e

echo "🔍 Checking prerequisites..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "   Run: ./setup-local.sh first"
    exit 1
fi

# Check if Redis is running
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "✅ Redis is running"
    else
        echo "⚠️  Redis is not running!"
        echo "   Start Redis with:"
        echo "   - macOS: brew services start redis"
        echo "   - Linux: sudo systemctl start redis"
        echo "   - Docker: docker run -d -p 6379:6379 redis:6.2"
        echo ""
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    echo "⚠️  redis-cli not found. Make sure Redis is installed and running."
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo ""
echo "🚀 Starting recall..."
echo ""
echo "📌 You need TWO terminal windows:"
echo ""
echo "Terminal 1 - Main Server:"
echo "   npm run dev"
echo ""
echo "Terminal 2 - Worker:"
echo "   npm run dev:worker"
echo ""
echo "Or use Docker Compose:"
echo "   docker compose up"
echo ""
read -p "Start server now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run dev
fi

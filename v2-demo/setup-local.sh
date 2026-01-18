#!/bin/bash

# Setup script for running v2-demo locally

set -e

echo "🚀 Setting up v2-demo for localhost..."

# Check if .env already exists
if [ -f .env ]; then
    echo "⚠️  .env file already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

# Create .env file with defaults
cat > .env << 'EOF'
# Required Environment Variables
SECRET=change-this-secret-key-in-production
RECALL_API_KEY=your-recall-api-key-here
RECALL_API_HOST=https://api.recall.ai
PUBLIC_URL=http://localhost:3003

# Redis Configuration (for Bull queue)
# For local development, use: redis://localhost:6379
REDIS_URL=redis://localhost:6379

# Server Configuration
PORT=3003
NODE_ENV=development

# OAuth Configuration (Optional - only if using Google Calendar or Microsoft Outlook)
# Google Calendar OAuth
GOOGLE_CALENDAR_OAUTH_CLIENT_ID=
GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=

# Microsoft Outlook OAuth
MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID=
MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET=
EOF

echo "✅ Created .env file"
echo ""
echo "📝 Please edit .env and update:"
echo "   1. SECRET - Generate a random secret (e.g., run: openssl rand -hex 32)"
echo "   2. RECALL_API_KEY - Your Recall API key"
echo "   3. RECALL_API_HOST - Usually https://api.recall.ai (base URL only, without /api/v1 or /api/v2)"
echo "   4. PUBLIC_URL - http://localhost:3003 for local dev"
echo "   5. REDIS_URL - redis://localhost:6379 (if Redis is local)"
echo ""
echo "🔧 Next steps:"
echo "   1. Install dependencies: npm install"
echo "   2. Make sure Redis is running (see README-LOCAL.md)"
echo "   3. Start the server: npm run dev"
echo "   4. Start the worker (in another terminal): npm run dev:worker"
echo ""
echo "📖 For detailed instructions, see README-LOCAL.md"

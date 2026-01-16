#!/bin/bash

# Railway CLI Deployment Script for V2 Demo
# This script helps deploy v2-demo to Railway

set -e

echo "🚂 Railway CLI Deployment for V2 Demo"
echo "======================================"
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found!"
    echo "   Install it with: npm i -g @railway/cli"
    exit 1
fi

echo "✅ Railway CLI found"
echo ""

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo "🔐 Please login to Railway..."
    echo "   This will open your browser"
    railway login
else
    echo "✅ Already logged in to Railway"
    railway whoami
fi

echo ""
echo "📋 Next steps:"
echo ""
echo "1. Create a new Railway project (if you don't have one):"
echo "   - Go to https://railway.app/new"
echo "   - Or run: railway init"
echo ""
echo "2. Link this project:"
echo "   railway link"
echo ""
echo "3. Add Redis service (via Railway dashboard):"
echo "   - Go to your Railway project"
echo "   - Click '+ New' → 'Database' → 'Add Redis'"
echo ""
echo "4. Set environment variables:"
echo "   railway variables set SECRET=\$(openssl rand -hex 32)"
echo "   railway variables set RECALL_API_KEY=your-key-here"
echo "   railway variables set RECALL_API_HOST=https://api.recall.ai"
echo "   railway variables set PUBLIC_URL=https://your-app.up.railway.app"
echo ""
echo "5. Deploy:"
echo "   railway up"
echo ""
echo "6. Create worker service (duplicate main service in Railway dashboard)"
echo "   and set start command to: npm run start:worker"
echo ""

read -p "Continue with linking? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    railway link
fi

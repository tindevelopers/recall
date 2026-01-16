#!/bin/bash
# Railway Deployment Script for V2 Demo
# This script deploys the latest code changes to Railway

set -e

echo "🚂 Railway Deployment Script"
echo "============================"
echo ""

# Check Railway CLI
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found!"
    echo "   Install with: npm i -g @railway/cli"
    exit 1
fi

# Check login
echo "📋 Checking Railway login status..."
if ! railway whoami &> /dev/null; then
    echo "🔐 Please login to Railway..."
    railway login
else
    railway whoami
fi

echo ""
echo "📦 Checking project link..."

# Check if project is linked
if ! railway status &> /dev/null; then
    echo "⚠️  Project not linked yet."
    echo ""
    echo "Please run this command in your terminal to link the project:"
    echo "   railway link"
    echo ""
    echo "Then run this script again, or continue with manual deployment:"
    echo ""
    exit 1
fi

echo "✅ Project is linked"
railway status

echo ""
echo "🔍 Checking current environment variables..."
railway variables

echo ""
echo "📤 Deploying latest code changes..."
echo ""

# Deploy the application
railway up

echo ""
echo "✅ Deployment initiated!"
echo ""
echo "📋 Next steps:"
echo "=============="
echo ""
echo "1. Check deployment status:"
echo "   railway status"
echo ""
echo "2. View logs:"
echo "   railway logs"
echo ""
echo "3. Get your domain:"
echo "   railway domain"
echo ""
echo "4. Update PUBLIC_URL (if needed):"
echo "   railway variables set PUBLIC_URL=\$(railway domain)"
echo ""
echo "5. Verify PostgreSQL is set up:"
echo "   - Check Railway dashboard for PostgreSQL service"
echo "   - Verify DATABASE_URL is set: railway variables | grep DATABASE_URL"
echo ""
echo "6. Ensure worker service is running:"
echo "   - Check Railway dashboard for worker service"
echo "   - Verify it has start command: npm run start:worker"
echo ""


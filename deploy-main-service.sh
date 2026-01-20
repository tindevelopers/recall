#!/bin/bash
# Deploy to Railway main service
# This script will help you deploy to the correct service

cd /Users/gene/Projects/recall

echo "🚂 Deploying to Railway"
echo "======================"
echo ""

# Check if project is linked
if ! railway status &> /dev/null; then
    echo "❌ Project not linked. Run: railway link --project recall-v2-demo"
    exit 1
fi

echo "✅ Project linked: recall-v2-demo"
echo ""

# Try to deploy - Railway will prompt for service if needed
echo "📤 Deploying latest code..."
echo ""
echo "Note: If multiple services exist, Railway will prompt you to select one."
echo "Common service names: web, api, main, v2-demo"
echo ""

railway up

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Check status: railway status"
echo "View logs: railway logs"



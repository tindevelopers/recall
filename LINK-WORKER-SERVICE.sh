#!/bin/bash
# Helper script to link to Railway worker service and test connection

set -e

echo "🔗 Railway Worker Service Linker & Tester"
echo "=========================================="
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it with: npm i -g @railway/cli"
    exit 1
fi

echo "📋 Step 1: Linking to worker service..."
echo ""
echo "The Railway CLI will prompt you to select a service."
echo "Look for a service named 'recall-worker' or similar."
echo ""
echo "Press Enter to continue..."
read

# Try to link to worker service
railway service v2-demo-worker 2>&1 || {
    echo ""
    echo "⚠️  Service 'v2-demo-worker' not found automatically."
    echo ""
    echo "Please run this command manually and select the worker service:"
    echo "  railway service"
    echo ""
    echo "Or if you know the exact service name:"
    echo "  railway service <service-name>"
    echo ""
    exit 1
}

echo ""
echo "✅ Linked to worker service!"
echo ""

# Check logs
echo "📋 Step 2: Checking worker logs..."
echo ""
railway logs --service v2-demo-worker --tail 30

echo ""
echo "📋 Step 3: Running connection test..."
echo ""
node recall/test-worker-connection.js

echo ""
echo "✅ Done! Check the output above to verify the connection."

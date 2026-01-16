#!/bin/bash
# Script to set up worker service on Railway

cd /Users/gene/Projects/recall

echo "🔧 Setting Up Worker Service on Railway"
echo "========================================"
echo ""

# Check if project is linked
if ! railway status &> /dev/null; then
    echo "❌ Project not linked. Run: railway link --project recall-v2-demo"
    exit 1
fi

echo "✅ Project linked: recall-v2-demo"
echo ""

# Check if worker service exists
if railway service v2-demo-worker &> /dev/null; then
    echo "✅ Worker service 'v2-demo-worker' already exists"
    railway service v2-demo-worker
else
    echo "⚠️  Worker service 'v2-demo-worker' not found"
    echo ""
    echo "To create the worker service, run this command in your terminal:"
    echo ""
    echo "   railway add --service v2-demo-worker"
    echo ""
    echo "When prompted:"
    echo "   1. Select 'Empty Service'"
    echo "   2. Enter service name: v2-demo-worker"
    echo "   3. Press Enter to skip variables (we'll set them separately)"
    echo ""
    read -p "Have you created the worker service? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo "Please create the worker service first, then run this script again."
        exit 1
    fi
fi

echo ""
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "1. Link to the worker service:"
echo "   railway service v2-demo-worker"
echo ""
echo "2. Set the start command (via Railway dashboard):"
echo "   - Go to Railway dashboard"
echo "   - Open 'v2-demo-worker' service"
echo "   - Go to Settings → Deploy"
echo "   - Set Start Command: npm run start:worker"
echo ""
echo "3. Copy environment variables from main service:"
echo "   railway variables --service recall-v2-demo > /tmp/main-vars.txt"
echo "   Then set them on worker service via dashboard"
echo ""
echo "4. Verify worker is running:"
echo "   railway logs --service v2-demo-worker --tail 50"
echo ""


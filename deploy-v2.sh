#!/bin/bash
# Quick deployment script for recall

echo "🚂 Deploying V2 Demo to Railway"
echo "================================"
echo ""

# Step 1: Login (if needed)
echo "Step 1: Checking Railway login..."
if ! railway whoami &> /dev/null; then
    echo "Please login to Railway (will open browser):"
    railway login
fi

# Step 2: Link project
echo ""
echo "Step 2: Linking project..."
if ! railway status &> /dev/null; then
    echo "Linking to Railway project..."
    railway link
else
    echo "✅ Project already linked"
    railway status
fi

# Step 3: Show next steps
echo ""
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "1. Add Redis service via Railway dashboard:"
echo "   - Go to https://railway.app"
echo "   - Click '+ New' → 'Database' → 'Add Redis'"
echo ""
echo "2. Set environment variables:"
echo "   railway variables set SECRET=\$(openssl rand -hex 32)"
echo "   railway variables set RECALL_API_KEY=your-key-here"
echo "   railway variables set RECALL_API_HOST=https://api.recall.ai/api/v1"
echo ""
echo "3. Deploy:"
echo "   railway up"
echo ""
echo "4. After deployment, update PUBLIC_URL:"
echo "   railway variables set PUBLIC_URL=\$(railway domain)"
echo ""
echo "5. Create worker service in Railway dashboard"
echo "   - Duplicate main service"
echo "   - Set start command: npm run start:worker"
echo ""

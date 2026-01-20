#!/bin/bash
# Script to link to Railway worker service and verify connection

cd /Users/gene/Projects/recall

echo "🔗 Linking to Railway Worker Service"
echo "====================================="
echo ""

# Check Railway status
echo "📋 Current Railway status:"
railway status
echo ""

echo "💡 To link to the worker service:"
echo ""
echo "1. Find the worker service name in Railway dashboard:"
echo "   - Go to: https://railway.app"
echo "   - Open project: recall-v2-demo"
echo "   - Look for worker service (might be named: recall-worker, v2-worker, etc.)"
echo ""
echo "2. Link to it using one of these commands:"
echo ""
echo "   railway service recall-worker"
echo "   # OR"
echo "   railway service v2-worker"
echo "   # OR"
echo "   railway service <exact-service-name>"
echo ""
echo "3. After linking, verify it's working:"
echo ""
echo "   railway logs --service <service-name> --tail 50"
echo ""
echo "Look for:"
echo "  ✅ Redis connection established - Queue is ready"
echo "  ✅ Scheduled periodic calendar sync"
echo ""

# Try common service names
echo "🔍 Trying to find worker service..."
for name in "recall-worker" "v2-worker" "worker" "recall-v2-worker"; do
  echo -n "  Checking $name... "
  if railway service "$name" &>/dev/null 2>&1; then
    echo "✅ Found!"
    echo ""
    echo "✅ Linked to: $name"
    echo ""
    echo "📋 Checking logs..."
    railway logs --service "$name" --tail 30
    exit 0
  else
    echo "❌"
  fi
done

echo ""
echo "⚠️  Could not find worker service automatically"
echo "💡 Please link manually using the instructions above"


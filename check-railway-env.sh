#!/bin/bash
# Script to check Railway environment variables and database connection

cd /Users/gene/Projects/recall

echo "🔍 Railway Environment Variables Check"
echo "======================================="
echo ""

# Check if project is linked
if ! railway status &> /dev/null; then
    echo "❌ Project not linked. Run: railway link --project recall-v2-demo"
    exit 1
fi

echo "✅ Project: recall-v2-demo"
echo ""

# Check for services
echo "📋 Available services:"
railway status
echo ""

echo "⚠️  Note: To check variables for a specific service, run:"
echo "   railway service <service-name>"
echo "   railway variables"
echo ""

# Try to get variables (will fail if no service linked, but that's ok)
echo "🔍 Checking environment variables..."
echo ""

if railway variables &> /dev/null; then
    railway variables
    echo ""
    
    # Check for DATABASE_URL
    if railway variables | grep -q "DATABASE_URL"; then
        echo "✅ DATABASE_URL is set"
        DB_URL=$(railway variables | grep "DATABASE_URL" | cut -d'=' -f2- | head -1)
        if [ ! -z "$DB_URL" ]; then
            echo "   Database URL found (hidden for security)"
        fi
    else
        echo "❌ DATABASE_URL is NOT set"
        echo "   → Add PostgreSQL service in Railway dashboard"
        echo "   → Railway will automatically create DATABASE_URL"
    fi
    
    # Check for other required vars
    echo ""
    echo "📋 Required Environment Variables:"
    echo ""
    
    REQUIRED_VARS=("SECRET" "RECALL_API_KEY" "RECALL_API_HOST" "PUBLIC_URL" "REDIS_URL" "PORT" "NODE_ENV")
    
    for var in "${REQUIRED_VARS[@]}"; do
        if railway variables | grep -q "^${var}="; then
            echo "✅ $var is set"
        else
            echo "❌ $var is NOT set"
        fi
    done
else
    echo "⚠️  No service linked. Link to a service first:"
    echo "   railway service <service-name>"
    echo ""
    echo "Common service names: web, api, main, v2-demo"
fi

echo ""
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "1. Link to your main service:"
echo "   railway service <service-name>"
echo ""
echo "2. Check variables:"
echo "   railway variables"
echo ""
echo "3. If DATABASE_URL is missing, add PostgreSQL:"
echo "   - Go to Railway dashboard"
echo "   - Click '+ New' → 'Database' → 'Add PostgreSQL'"
echo ""
echo "4. View logs to see database connection:"
echo "   railway logs --tail 100"



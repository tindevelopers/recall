#!/bin/bash
# Script to check worker environment variables in Railway

echo "🔍 Worker Environment Variables Check"
echo "======================================"
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it with:"
    echo "   npm i -g @railway/cli"
    exit 1
fi

# Check if project is linked
if ! railway status &> /dev/null; then
    echo "⚠️  Project not linked. Run: railway link"
    echo ""
    echo "Then link to your worker service:"
    echo "   railway service <worker-service-name>"
    exit 1
fi

echo "✅ Railway project linked"
echo ""

# Check if service is linked
SERVICE_NAME=$(railway status 2>/dev/null | grep -i "service" | head -1 | awk '{print $2}' || echo "")
if [ -z "$SERVICE_NAME" ]; then
    echo "⚠️  No service linked. Link to worker service:"
    echo "   railway service <worker-service-name>"
    echo ""
    echo "Common worker service names: worker, recall-worker"
    exit 1
fi

echo "📋 Service: $SERVICE_NAME"
echo ""

# Get variables
echo "🔍 Checking environment variables..."
echo ""

VARS_OUTPUT=$(railway variables 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$VARS_OUTPUT" ]; then
    echo "❌ Could not retrieve variables. Make sure you're linked to a service:"
    echo "   railway service <worker-service-name>"
    exit 1
fi

# Required variables
REQUIRED_VARS=(
    "DATABASE_URL:PostgreSQL connection string"
    "REDIS_URL:Redis connection string"
    "RECALL_API_KEY:Recall.ai API key"
    "RECALL_API_HOST:Recall.ai API host"
    "PUBLIC_URL:Public URL for webhooks"
    "NODE_ENV:Node environment"
)

# Optional but recommended
OPTIONAL_VARS=(
    "OPENAI_API_KEY:OpenAI API key (for fallback summarization)"
    "OPENAI_MODEL_SUMMARY:OpenAI model for summaries"
    "OPENAI_MODEL_EMBEDDINGS:OpenAI model for embeddings"
)

echo "📋 Required Environment Variables:"
echo "=================================="
echo ""

MISSING_REQUIRED=0
for var_info in "${REQUIRED_VARS[@]}"; do
    IFS=':' read -r var_name var_desc <<< "$var_info"
    if echo "$VARS_OUTPUT" | grep -q "^${var_name}="; then
        VALUE=$(echo "$VARS_OUTPUT" | grep "^${var_name}=" | cut -d'=' -f2- | head -1)
        if [ -z "$VALUE" ] || [ "$VALUE" = "" ]; then
            echo "⚠️  $var_name is set but empty"
            MISSING_REQUIRED=$((MISSING_REQUIRED + 1))
        else
            # Mask sensitive values
            if [[ "$var_name" == *"KEY"* ]] || [[ "$var_name" == *"SECRET"* ]] || [[ "$var_name" == *"PASSWORD"* ]]; then
                MASKED_VALUE="${VALUE:0:8}...${VALUE: -4}"
                echo "✅ $var_name is set ($MASKED_VALUE)"
            elif [[ "$var_name" == "DATABASE_URL" ]] || [[ "$var_name" == "REDIS_URL" ]]; then
                # Show host/port but mask credentials
                if [[ "$VALUE" == *"@"* ]]; then
                    HOST_PORT=$(echo "$VALUE" | sed 's/.*@\(.*\)/\1/')
                    echo "✅ $var_name is set (***@$HOST_PORT)"
                else
                    echo "✅ $var_name is set"
                fi
            else
                echo "✅ $var_name is set ($VALUE)"
            fi
        fi
    else
        echo "❌ $var_name is NOT set"
        echo "   → $var_desc"
        MISSING_REQUIRED=$((MISSING_REQUIRED + 1))
    fi
done

echo ""
echo "📋 Optional Environment Variables:"
echo "================================="
echo ""

for var_info in "${OPTIONAL_VARS[@]}"; do
    IFS=':' read -r var_name var_desc <<< "$var_info"
    if echo "$VARS_OUTPUT" | grep -q "^${var_name}="; then
        VALUE=$(echo "$VARS_OUTPUT" | grep "^${var_name}=" | cut -d'=' -f2- | head -1)
        if [[ "$var_name" == *"KEY"* ]]; then
            MASKED_VALUE="${VALUE:0:8}...${VALUE: -4}"
            echo "✅ $var_name is set ($MASKED_VALUE)"
        else
            echo "✅ $var_name is set ($VALUE)"
        fi
    else
        echo "⚪ $var_name is not set (optional)"
        echo "   → $var_desc"
    fi
done

echo ""
echo "=================================="
echo ""

if [ $MISSING_REQUIRED -eq 0 ]; then
    echo "✅ All required environment variables are set!"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Check worker logs: railway logs --tail 50"
    echo "   2. Verify worker is processing jobs"
    echo "   3. Test bot scheduling functionality"
else
    echo "❌ Missing $MISSING_REQUIRED required environment variable(s)"
    echo ""
    echo "📋 To set missing variables:"
    echo "   railway variables set <VAR_NAME>=<value>"
    echo ""
    echo "Example:"
    echo "   railway variables set RECALL_API_KEY=your-key-here"
    echo "   railway variables set RECALL_API_HOST=https://api.recall.ai"
    echo "   railway variables set PUBLIC_URL=https://your-app.up.railway.app"
    exit 1
fi



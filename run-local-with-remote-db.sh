#!/bin/bash
# Run the app on localhost using the remote (e.g. Railway) database.
# Option A: Run ./setup-localhost.sh first to pull vars from Railway into recall/.env
# Option B: Manually set DATABASE_URL (and other vars) in recall/.env

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="recall/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ recall/.env not found."
    if command -v railway &> /dev/null; then
        echo "   Running setup to pull variables from Railway..."
        ./setup-localhost.sh
    else
        echo "   Create recall/.env with at least: DATABASE_URL, RECALL_API_KEY, RECALL_API_HOST, PUBLIC_URL=http://localhost:3003, SECRET"
        echo "   See QUICK-LOCALHOST-SETUP.md or env.example"
        exit 1
    fi
fi

if ! grep -q "^DATABASE_URL=" "$ENV_FILE" || ! grep "^DATABASE_URL=" "$ENV_FILE" | grep -q "proxy.rlwy.net\|railway"; then
    echo "⚠️  DATABASE_URL in recall/.env may not be a remote DB (e.g. Railway)."
    echo "   For remote DB, set DATABASE_URL to your Railway/Postgres URL in recall/.env"
    echo "   Continuing anyway..."
fi

echo "🚀 Starting app on localhost with env from recall/.env (remote DB if DATABASE_URL is set)"
echo "   Main server: http://localhost:3003"
echo "   Start worker in another terminal: cd recall && npm run dev:worker"
echo ""

cd recall
npm run dev

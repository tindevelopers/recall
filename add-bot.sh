#!/bin/bash
# Simple wrapper to add a bot to a Recall calendar event
# Usage: ./add-bot.sh <recallEventId>

if [ -z "$1" ]; then
    echo "🤖 Add Bot to Recall Calendar Event"
    echo "==================================="
    echo ""
    echo "Usage: ./add-bot.sh <recallEventId>"
    echo ""
    echo "To find a Recall Event ID:"
    echo "  1. Go to Recall.ai dashboard: https://us-west-2.recall.ai/dashboard/explorer/calendar-event"
    echo "  2. Copy the Event ID from any calendar event"
    echo "  3. Or use an event ID from your connected calendars"
    echo ""
    echo "Example:"
    echo "  ./add-bot.sh abc123-def456-ghi789"
    exit 1
fi

RECALL_EVENT_ID="$1"

echo "🤖 Adding bot to Recall event: $RECALL_EVENT_ID"
echo ""

# Get remote DATABASE_URL from Railway
REMOTE_DB_URL=$(railway variables --json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('DATABASE_URL', ''))" 2>/dev/null)

if [ -z "$REMOTE_DB_URL" ]; then
    echo "⚠️  Could not get remote DATABASE_URL from Railway"
    echo "   Falling back to local database..."
    REMOTE_DB_URL="postgresql://127.0.0.1:5432/recall_v2_demo"
fi

cd v2-demo && DATABASE_URL="$REMOTE_DB_URL" node test-add-bot.js "$RECALL_EVENT_ID"

#!/bin/bash
# Script to add a bot to a calendar event in Recall.ai for testing
# Usage: ./test-add-bot.sh [recallEventId] [meetingUrl]

DOMAIN="http://localhost:3003"

echo "🤖 Adding Bot to Recall Calendar Event"
echo "======================================"
echo ""

# Check if event ID was provided
if [ -n "$1" ]; then
    RECALL_EVENT_ID="$1"
    echo "✅ Using provided Recall Event ID: $RECALL_EVENT_ID"
else
    # Try to get event ID from database
    echo "📋 Getting recent calendar event from database..."
    
    cat > /tmp/get-event-id.mjs << 'EOF'
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "v2-demo", ".env") });
import db from "./v2-demo/db.js";
try {
  await db.connect();
  const event = await db.CalendarEvent.findOne({
    where: {
      meetingUrl: { [db.Sequelize.Op.ne]: null }
    },
    order: [['createdAt', 'DESC']],
    limit: 1,
    include: [{ model: db.Calendar }]
  });
  if (event && event.recallId) {
    console.log(JSON.stringify({
      recallId: event.recallId,
      meetingUrl: event.meetingUrl,
      startTime: event.startTime?.toISOString(),
      calendarId: event.calendarId
    }));
  } else {
    console.log('');
  }
  process.exit(0);
} catch (error) {
  console.log('');
  process.exit(0);
}
EOF
    
    EVENT_DATA=$(cd /Users/foo/projects/Recall.ai && node /tmp/get-event-id.mjs 2>/dev/null)
    rm -f /tmp/get-event-id.mjs
    
    if [ -z "$EVENT_DATA" ]; then
        echo "❌ Could not find calendar events with meeting URLs in database."
        echo "   Please provide a recallEventId as an argument:"
        echo "   ./test-add-bot.sh <recallEventId> [meetingUrl]"
        exit 1
    fi
    
    RECALL_EVENT_ID=$(echo "$EVENT_DATA" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data['recallId'])" 2>/dev/null)
    MEETING_URL=$(echo "$EVENT_DATA" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('meetingUrl', ''))" 2>/dev/null)
    
    echo "✅ Found calendar event:"
    echo "   Recall Event ID: $RECALL_EVENT_ID"
    echo "   Meeting URL: ${MEETING_URL:-'Not set'}"
    echo ""
fi

# Use provided meeting URL or the one from database
MEETING_URL="${2:-$MEETING_URL}"

# Calculate join_at time (10 minutes before now for immediate testing, or use event start time)
JOIN_AT=$(date -u -v+10M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "+10 minutes" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")

echo "📤 Adding bot to calendar event..."
echo "   Event ID: $RECALL_EVENT_ID"
echo "   Join At: ${JOIN_AT:-'Will be calculated by API'}"
echo ""

# Build bot config with transcription enabled
BOT_CONFIG=$(cat <<EOF
{
  "recording_config": {
    "video": true,
    "audio": true,
    "transcript": {
      "provider": {
        "recallai_streaming": {
          "mode": "prioritize_low_latency"
        }
      }
    },
    "realtime_endpoints": [
      {
        "type": "webhook",
        "url": "${DOMAIN}/webhooks/recall-notes",
        "events": [
          "transcript.partial_data",
          "transcript.data",
          "transcript.done",
          "recording.done",
          "bot.status_change"
        ]
      }
    ]
  },
  "join_at": "${JOIN_AT}"
}
EOF
)

# Use the API endpoint to add the bot
echo "🔧 Using debug-bot-config endpoint to add bot..."
RESPONSE=$(curl -s -X POST "${DOMAIN}/api/debug-bot-config?eventId=${RECALL_EVENT_ID}&enqueue=true" \
  -H "Content-Type: application/json" 2>&1)

if echo "$RESPONSE" | grep -q "error\|Error"; then
    echo "❌ Error adding bot:"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    exit 1
else
    echo "✅ Bot scheduling job enqueued!"
    echo ""
    echo "Response:"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    echo ""
    echo "🔍 Check bot status in Recall dashboard:"
    echo "   https://us-west-2.recall.ai/dashboard/explorer/bot"
    echo ""
    echo "Or check server logs for bot scheduling:"
    echo "   tail -f /tmp/v2-demo-server.log | grep BOT_CONFIG"
fi

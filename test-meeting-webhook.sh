#!/bin/bash
# Script to simulate a webhook payload with recording and transcription data
# This helps test if the webhook handler correctly processes recording and transcript data
#
# Usage: ./test-meeting-webhook.sh [recallEventId]
#   If recallEventId is provided, it will be used directly
#   Otherwise, the script will try to get it from the database

DOMAIN="http://localhost:3003"
CALENDAR_ID="3b79831b-842b-4521-9211-8984bb0e818e"

echo "🧪 Testing Meeting Webhook Payload"
echo "=================================="
echo ""

# Check if event ID was provided as argument
if [ -n "$1" ]; then
    EVENTS="$1"
    echo "✅ Using provided Recall Event ID: $EVENTS"
    echo ""
else
    # Try to get event ID from database directly using a helper script
    echo "📋 Getting recent calendar event from database..."
    
    # Create a temporary helper script
    cat > /tmp/get-event-id.mjs << 'EOF'
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Try to load .env file from v2-demo directory
config({ path: join(__dirname, "v2-demo", ".env") });
import db from "./v2-demo/db.js";
try {
  await db.connect();
  const event = await db.CalendarEvent.findOne({
    order: [['createdAt', 'DESC']],
    limit: 1
  });
  if (event && event.recallId) {
    console.log(event.recallId);
  } else {
    console.log('');
  }
  process.exit(0);
} catch (error) {
  console.log('');
  process.exit(0);
}
EOF
    
    EVENTS=$(cd /Users/foo/projects/Recall.ai && node /tmp/get-event-id.mjs 2>/dev/null)
    rm -f /tmp/get-event-id.mjs
    
    if [ -z "$EVENTS" ]; then
        echo "⚠️  Could not find calendar events in database."
        echo "   Using test event ID for webhook testing..."
        EVENTS="test-event-$(date +%s)"
        echo "   Test Event ID: $EVENTS"
        echo ""
    else
        echo "✅ Found calendar event with Recall ID: $EVENTS"
        echo ""
    fi
fi

# Simulate a webhook payload with recording and transcription
echo "📤 Sending test webhook with recording and transcription data..."

curl -X POST "$DOMAIN/webhooks/recall-notes" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "recording.done",
    "data": {
      "calendar_event_id": "'"$EVENTS"'",
      "bot_id": "test-bot-123",
      "video_url": "https://example.com/recording.mp4",
      "audio_url": "https://example.com/recording.mp3",
      "recording_url": "https://example.com/recording.mp4",
      "transcript": {
        "segments": [
          {
            "text": "Hello, this is a test transcript segment.",
            "start_time": 0.0,
            "end_time": 3.5,
            "speaker": "Speaker 1"
          },
          {
            "text": "Yes, I can hear you clearly.",
            "start_time": 3.5,
            "end_time": 6.2,
            "speaker": "Speaker 2"
          }
        ]
      },
      "transcript_segments": [
        {
          "text": "This is an alternative transcript format.",
          "start_ms": 0,
          "end_ms": 2500,
          "speaker": "Speaker 1"
        }
      ]
    }
  }' | jq '.' 2>/dev/null || echo "Webhook sent"

echo ""
echo "✅ Test webhook sent!"
echo ""
echo "🔍 Check the payload with:"
echo "curl \"$DOMAIN/api/check-meeting-payload?recallEventId=$EVENTS\" | jq '.'"

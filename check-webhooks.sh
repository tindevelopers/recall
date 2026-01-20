#!/bin/bash
# Script to check webhook configuration for a calendar

DOMAIN="https://recall-recall-production.up.railway.app"

echo "🔍 Webhook Debug Tool"
echo "===================="
echo ""

if [ -z "$1" ]; then
  echo "Usage: $0 <calendar-id>"
  echo ""
  echo "To get your calendar ID:"
  echo "1. Go to: $DOMAIN/settings"
  echo "2. Check the URL for ?calendarId=<uuid> or look at the calendar dropdown"
  echo "3. Or go to: $DOMAIN/calendar/<id> and use the <id> from the URL"
  echo ""
  exit 1
fi

CALENDAR_ID="$1"

echo "Checking webhook configuration for calendar: $CALENDAR_ID"
echo ""

curl -s "$DOMAIN/api/debug-webhooks?calendarId=$CALENDAR_ID" | jq '.' 2>/dev/null || curl -s "$DOMAIN/api/debug-webhooks?calendarId=$CALENDAR_ID"

echo ""
echo ""
echo "💡 If webhook URL doesn't match, update it with:"
echo "curl -X POST $DOMAIN/api/update-webhook-url \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"calendarId\":\"$CALENDAR_ID\"}'"

# Create Test Meeting Instructions

To test if webhook payloads include recording and transcription data:

## Option 1: Create a Zoom Test Meeting (Recommended)

1. **Create a Zoom meeting** scheduled for 10 minutes from now:
   - Go to https://zoom.us and create a new meeting
   - Set it to start in 10 minutes
   - Copy the meeting URL

2. **Add it to your calendar** (Outlook/Google Calendar):
   - Create a new calendar event
   - Set the start time to 10 minutes from now
   - Add the Zoom meeting URL to the event
   - Save the event

3. **Wait for sync**:
   - The event should sync to Recall.ai within a few minutes
   - A bot should be scheduled to attend

4. **Join the meeting** when it starts:
   - Join the Zoom meeting
   - The bot should join automatically
   - Have a brief conversation (30 seconds to 1 minute)
   - End the meeting

5. **Check webhooks**:
   - Webhooks should arrive within a few minutes after the meeting ends
   - Run: `./monitor-meeting-webhooks.sh` to monitor
   - Or check: `curl "http://localhost:3003/api/check-meeting-payload?recallEventId=<event-id>"`

## Option 2: Use Existing Meeting

If you have an upcoming meeting with a meeting URL:
1. Wait for it to start
2. Join the meeting
3. Let the bot attend
4. Monitor webhooks as above

## Monitoring Commands

```bash
# Monitor webhooks in real-time
./monitor-meeting-webhooks.sh

# Or check specific meeting artifact
curl "http://localhost:3003/api/check-meeting-payload?recallEventId=<event-id>" | jq '.'

# Check Railway logs
railway logs --tail 100 | grep -E "\[RECALL-NOTES\]|Recording|Transcript"
```

## Expected Payload Structure

When webhooks arrive, they should include:

**Recording Data:**
- `data.video_url` or `data.videoUrl`
- `data.audio_url` or `data.audioUrl`
- `data.recording_url` or `data.recordingUrl`

**Transcription Data:**
- `data.transcript.segments[]` - Array of transcript segments
- `data.transcript_segments[]` - Alternative format
- `data.words[]` - Word-level transcription (streaming)
- `data.segments[]` - Direct segments array

## Webhook Events to Watch For

- `transcript.partial_data` - Streaming transcript chunks
- `transcript.data` - Final transcript segments
- `transcript.done` - Transcription completed
- `recording.done` - Recording finished (should include recording URLs)
- `bot.status_change` - Bot lifecycle events

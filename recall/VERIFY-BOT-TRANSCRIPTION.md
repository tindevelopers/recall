# Verifying Bot Transcription Configuration

This guide explains how to verify that bots are correctly configured to request transcripts when joining meetings.

## ✅ Test Results

The bot configuration logic has been tested and verified:

- ✅ **When transcription is ENABLED**: Bot config includes `transcription` object with provider, mode, and language
- ✅ **When transcription is DISABLED**: Bot config omits `transcription` object entirely
- ✅ **Real-time mode**: Transcription happens during the meeting
- ✅ **Async mode**: Transcription happens after the meeting ends
- ✅ **Provider selection**: Supports both "default" (Recall.ai) and "retell" providers

## 🔍 How to Verify in Production

### 1. Check Bot Configuration Logs

When a bot is scheduled, the system logs the exact configuration being sent to Recall API:

```
[BOT_CONFIG] Sending bot config for event {eventId}: {json}
```

**Look for**:
- `transcription` object present when transcription is enabled
- `transcription.mode` set to "realtime" or "async"
- `transcription.provider` set to "default" or "retell"
- `transcription.language` set to language code (e.g., "en")

**Example with transcription enabled**:
```json
{
  "bot_name": "Meeting Assistant",
  "transcription": {
    "provider": "default",
    "mode": "realtime",
    "language": "en"
  },
  "recording": {
    "video": true,
    "audio": true
  }
}
```

**Example with transcription disabled**:
```json
{
  "bot_name": "Meeting Assistant",
  "recording": {
    "video": true,
    "audio": true
  }
}
```

### 2. Check Calendar Settings

Go to `/calendar/{calendarId}` and verify:
- **Settings Overview** card shows transcription status
- **Bot Settings** card shows "Enable Transcription" checkbox state
- Transcription mode (Real-time vs Async) is displayed

### 3. Verify Bot Joins with Transcription

After a bot joins a meeting:

1. **Check webhook logs** for transcript data:
   ```
   [INFO] Received Recall notes webhook: event=...
   [INFO] Has transcript: true
   ```

2. **Check database** for transcript segments:
   - `meeting_transcript_chunks` table should have entries
   - Each chunk should have `text`, `speaker`, `startTimeMs`, `endTimeMs`

3. **Check Recall.ai dashboard**:
   - Bot should show transcription status
   - Transcript should be available in Recall.ai UI

### 4. Run Test Script

Run the test script to verify configuration logic:

```bash
cd recall
node test-bot-transcription-config.js
```

This will show:
- Bot config for different calendar settings
- Validation that transcription is included/excluded correctly
- Mode and provider settings

## 🐛 Troubleshooting

### Bot not transcribing?

1. **Check calendar settings**:
   - Go to Calendar Settings → Bot Settings
   - Verify "Enable Transcription" is checked
   - Verify transcription mode is set

2. **Check logs**:
   - Look for `[BOT_CONFIG]` logs when bot is scheduled
   - Verify `transcription` object is present in the config

3. **Check bot status**:
   - In Recall.ai dashboard, check if bot joined successfully
   - Verify bot has transcription permissions

4. **Check webhooks**:
   - Verify webhook endpoint is accessible: `/webhooks/recall-calendar-updates`
   - Check if transcript webhooks are being received

### Transcription config missing?

If `transcription` is not in bot config when it should be:

1. Check `calendar.enableTranscription` value in database
2. Verify migration `20260117000400-add-transcription-mode-to-calendars.js` ran
3. Check that `transcriptionMode` field exists in calendars table

### Transcription not working even when enabled?

1. **Check Recall.ai API**:
   - Verify API key is valid
   - Check if transcription provider is available
   - Verify bot has necessary permissions

2. **Check webhook payload**:
   - Look for `transcript` or `transcript_segments` in webhook data
   - Verify segments are being extracted correctly

3. **Check enrichment logs**:
   - Look for `[ENRICH]` logs showing transcript processing
   - Verify Notepad service is being called

## 📋 Code Locations

- **Bot config builder**: `recall/worker/processors/calendar-event-update-bot-schedule.js` (lines 34-45)
- **Settings UI**: `recall/views/partials/calendar-bot-settings-card.ejs`
- **Settings handler**: `recall/routes/calendar/update-bot-settings.js`
- **Test script**: `recall/test-bot-transcription-config.js`

## ✅ Expected Behavior

When transcription is **ENABLED**:
- Bot config includes `transcription` object
- Bot requests transcripts when joining meeting
- Transcripts are received via webhooks
- Transcripts are stored in database
- Summaries and action items are generated

When transcription is **DISABLED**:
- Bot config omits `transcription` object
- Bot does NOT request transcripts
- No transcript webhooks received
- No transcript data stored

## 🎯 Quick Verification Checklist

- [ ] Calendar has `enable_transcription = true` in database
- [ ] Bot config logs show `transcription` object
- [ ] Bot joins meeting successfully
- [ ] Webhook receives transcript data
- [ ] Transcript segments stored in database
- [ ] Summary and action items generated

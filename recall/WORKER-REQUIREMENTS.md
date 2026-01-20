# Worker Requirements for Transcription

## ⚠️ Critical: Worker MUST Be Running

**YES, the worker service MUST be running for transcription to work.**

### Why the Worker is Required

1. **Bot Scheduling**: The worker schedules bots with transcription configuration **BEFORE** meetings start
   - When a calendar event is created/updated, the worker processes it
   - The worker builds the `bot_config` with `recording_config.transcript` settings
   - This config is sent to Recall.ai API to schedule the bot

2. **Webhook Processing**: The worker processes transcript webhooks **AFTER** meetings end
   - When Recall.ai sends transcript data via webhooks, the worker stores it
   - Without the worker, transcripts won't be saved to your database

### What Happens If Worker Isn't Running

❌ **Before Meeting**: Bot is scheduled WITHOUT transcription config → No transcripts generated  
❌ **During Meeting**: Bot joins but has no transcription instructions → No transcripts  
❌ **After Meeting**: Transcript webhooks arrive but aren't processed → Transcripts lost  

## 🔍 How to Verify Worker is Running

### On Railway

1. **Check Worker Service Status**:
   - Go to Railway dashboard
   - Find the "recall-worker" service (or your worker service name)
   - Verify it shows "Running" status
   - Check logs for errors

2. **Check Worker Logs**:
   ```bash
   railway logs --service recall-worker
   ```
   
   Look for:
   - `INFO: Schedule bot for event {id}` - Worker is processing events
   - `[BOT_CONFIG] Sending bot config for event {id}` - Bot config being sent
   - `[BOT_CONFIG] Bot scheduled successfully` - Bot scheduled with config

3. **Verify Bot Config Includes Transcription**:
   In the logs, you should see:
   ```json
   {
     "recording_config": {
       "video": true,
       "audio": true,
       "transcript": {
         "provider": "recallai_streaming",
         "mode": "prioritize_accuracy"
       }
     }
   }
   ```

### Common Issues

#### Worker Not Running
- **Symptom**: No `[BOT_CONFIG]` logs before meetings
- **Fix**: Start the worker service in Railway

#### Worker Crashed
- **Symptom**: Worker shows "Stopped" or "Error" status
- **Fix**: Check logs for errors, restart the service

#### Worker Not Processing Jobs
- **Symptom**: Events created but no bot scheduling logs
- **Fix**: 
  - Check Redis connection (`REDIS_URL` environment variable)
  - Verify Bull queue is working
  - Check for queue processing errors in logs

## 📋 Deployment Checklist

- [ ] Worker service is deployed and running
- [ ] Worker has access to same environment variables as main app
- [ ] `REDIS_URL` is set correctly
- [ ] `DATABASE_URL` is set correctly
- [ ] `RECALL_API_KEY` is set correctly
- [ ] Worker start command: `npm run start:worker` (or `npm run dev:worker` for dev)

## 🧪 Testing Worker is Working

1. **Create a test calendar event** with `shouldRecordAutomatic: true`
2. **Check worker logs** for:
   ```
   INFO: Schedule bot for event {id}
   [BOT_CONFIG] Sending bot config for event {id}: {...}
   ```
3. **Verify bot config** includes `recording_config.transcript`
4. **Check Recall.ai dashboard** to see if bot was scheduled with transcription enabled

## 🔧 Troubleshooting

### No Transcription Config in Logs

If you see bot config without `transcript`:
1. Check calendar settings: `/calendar/{calendarId}`
2. Verify "Enable Transcription" is checked
3. Check `calendar.enableTranscription` in database

### Worker Processing But No Transcription

If worker is running but transcripts still not working:
1. Verify `recording_config.transcript.provider` is `"recallai_streaming"` (not `"default"`)
2. Check that `mode` is set correctly (`"prioritize_accuracy"` or `"prioritize_low_latency"`)
3. Verify webhook endpoints are configured in Recall.ai dashboard
4. Check that bot actually joined the meeting (check Recall.ai dashboard)

### Worker Can't Connect to Redis

Error: `ECONNREFUSED` or `Redis connection failed`
- Verify `REDIS_URL` is set
- Check Redis service is running
- Verify network connectivity between services

# Bot Scheduling Diagnosis & Fixes

## Issues Found and Fixed

### 1. ✅ Fixed: Job Name Mismatch in Debug Endpoint
**File**: `recall/routes/api/debug-bot-config.js`

**Problem**: The debug endpoint was using the wrong job name:
- ❌ Wrong: `"calendar-event.update-bot-schedule"` (with hyphens)
- ✅ Correct: `"calendarevent.update_bot_schedule"` (with underscores)

**Impact**: Jobs queued from this endpoint would never be processed by the worker.

**Fix**: Updated job name and data fields to match the worker's expected format.

### 2. ✅ Fixed: Missing Null Check in Bot Scheduling Processor
**File**: `recall/worker/processors/calendar-event-update-bot-schedule.js`

**Problem**: The processor didn't check if the event exists before accessing its properties. If an event wasn't synced to the database yet, the job would crash with a TypeError.

**Impact**: Jobs would fail silently when events weren't synced yet, preventing bot scheduling.

**Fix**: Added null check to gracefully handle missing events.

## Diagnostic Tools Created

### 1. Bot Scheduling Diagnostic Script
**File**: `recall/diagnose-bot-scheduling.js`

Run this script to check:
- Redis/Queue connection status
- Queued, active, and failed jobs
- Events that should have bots scheduled
- Periodic sync job status

**Usage**:
```bash
cd recall
node diagnose-bot-scheduling.js
```

## Common Issues to Check

### 1. Worker Not Running
**Symptoms**: Jobs queued but never processed

**Check**:
```bash
railway logs --service recall-worker --tail 50
```

**Look for**:
- ✅ `INFO: Database connection established`
- ✅ `INFO: Recall service initialized`
- ✅ `🎯 Worker is now listening for jobs...`
- ❌ `Server ready at http://0.0.0.0:3003` (this means worker is running main app instead!)

**Fix**: Ensure worker service start command is `npm run start:worker` (not `npm start`)

### 2. Events Not Synced to Database
**Symptoms**: Jobs fail with "Event not found" warnings

**Check**: Run diagnostic script or check database:
```bash
cd recall
node diagnose-bot-scheduling.js
```

**Fix**: Ensure periodic sync is running (should run every 2 minutes). Check worker logs for:
```
⏰ Scheduled periodic calendar sync (every 2 minutes)
```

### 3. Events Missing Meeting URLs
**Symptoms**: Events exist but bots aren't scheduled

**Check**: Events need `meetingUrl` field to schedule bots. Check diagnostic output:
```
Meeting URL: ❌ No (required for bot)
```

**Fix**: Ensure calendar events have meeting URLs (Zoom, Teams, Google Meet links)

### 4. Auto-Record Settings Disabled
**Symptoms**: Events exist but `shouldRecordAutomatic` is false

**Check**: Calendar settings:
- `autoRecordExternalEvents` - for meetings with external attendees
- `autoRecordInternalEvents` - for meetings with same-domain attendees

**Fix**: Enable auto-record settings in calendar settings UI

### 5. Events in the Past
**Symptoms**: Bots not scheduled for past events

**Check**: Bot scheduling only works for future events. The processor skips events where `startTime <= new Date()`.

**Fix**: This is expected behavior - bots can't join meetings that have already started.

## Verification Steps

1. **Check Worker Status**:
   ```bash
   railway logs --service recall-worker --tail 100 | grep -i "worker\|job\|bot"
   ```

2. **Check for Failed Jobs**:
   ```bash
   cd recall
   node diagnose-bot-scheduling.js
   ```

3. **Check Specific Event**:
   - Use diagnostic endpoint: `/api/diagnose-bot-scheduling`
   - Check database for event: `shouldRecordAutomatic`, `shouldRecordManual`, `meetingUrl`

4. **Manually Trigger Sync**:
   ```bash
   # Via API endpoint (if available)
   curl -X POST https://your-app.com/api/trigger-calendar-sync
   ```

## Expected Flow

1. ✅ Calendar events synced from Recall.ai (via webhooks or periodic sync)
2. ✅ Auto-record status updated based on calendar settings
3. ✅ Bot scheduling jobs queued for events that should be recorded
4. ✅ Worker processes jobs and schedules bots via Recall.ai API
5. ✅ Bots appear in Recall.ai dashboard and join meetings

## Next Steps

1. **Deploy fixes**: The code fixes should be deployed to production
2. **Run diagnostic**: Use `diagnose-bot-scheduling.js` to check current status
3. **Check worker logs**: Verify worker is running and processing jobs
4. **Monitor**: Watch for bot scheduling activity in worker logs

## Related Files

- `recall/worker/processors/calendar-event-update-bot-schedule.js` - Bot scheduling processor
- `recall/worker/processors/periodic-calendar-sync.js` - Periodic sync that queues bot scheduling
- `recall/worker/processors/calendar-events-update-autorecord.js` - Updates auto-record status
- `recall/logic/autorecord.js` - Auto-record logic
- `recall/logic/bot-config.js` - Bot configuration builder


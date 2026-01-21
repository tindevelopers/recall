# Fix: Duplicate Bot Attendance Issue

## Problem

Bots were attending meetings twice because multiple webhooks were triggering sync jobs, which each queued bot scheduling jobs without deduplication.

## Root Cause

1. **Multiple webhook triggers**: When a calendar event is created/updated, Recall sends multiple webhooks:
   - `calendar.update` → triggers sync
   - `calendar.event.created` → triggers sync
   - `calendar.event.updated` → triggers sync
   - `calendar.sync_events` → triggers sync

2. **No job deduplication**: Each sync job would queue bot scheduling jobs for all events, but there was no mechanism to prevent duplicate bot scheduling jobs for the same event.

3. **Recall API deduplication**: While the Recall API uses a `deduplicationKey` to prevent duplicate bots, multiple API calls could still happen if jobs were queued multiple times.

## Solution

Added job-level deduplication using Bull queue's `jobId` feature:

1. **Created helper function** (`utils/queue-bot-schedule.js`):
   - Uses `jobId: bot-schedule-${recallEventId}` to prevent duplicate jobs
   - If a job with the same ID already exists, it won't be added again

2. **Updated all bot scheduling job queues** to use the helper:
   - `worker/processors/calendar-events-update-autorecord.js`
   - `worker/processors/periodic-calendar-sync.js`
   - `routes/calendar/update-bot-settings.js`
   - `routes/calendar/update.js`
   - `routes/calendar-event/set-manual-record.js`
   - `routes/meetings/update-transcription-mode.js`
   - `routes/api/debug-bot-config.js`

## How It Works

- Each bot scheduling job now has a unique `jobId` based on the Recall event ID
- Bull queue prevents duplicate jobs with the same `jobId`
- If a job already exists (waiting, active, or recently completed), a new one won't be added
- The Recall API's `deduplicationKey` provides an additional layer of protection

## Testing

Run the diagnostic script to check for duplicate bots:

```bash
cd recall
node check-duplicate-bots.js
```

This will:
- Check recent meetings for duplicate bots in Recall API
- Check the job queue for duplicate bot scheduling jobs

## Configuration

No configuration changes needed. The fix is automatic and works with existing Bull queue setup.

## Files Changed

- ✅ `recall/utils/queue-bot-schedule.js` (new)
- ✅ `recall/worker/processors/calendar-events-update-autorecord.js`
- ✅ `recall/worker/processors/periodic-calendar-sync.js`
- ✅ `recall/routes/calendar/update-bot-settings.js`
- ✅ `recall/routes/calendar/update.js`
- ✅ `recall/routes/calendar-event/set-manual-record.js`
- ✅ `recall/routes/meetings/update-transcription-mode.js`
- ✅ `recall/routes/api/debug-bot-config.js`
- ✅ `recall/check-duplicate-bots.js` (diagnostic script)

## Next Steps

1. Deploy the changes to Railway
2. Monitor logs for duplicate bot scheduling jobs (should see "Job already queued" messages)
3. Test by creating a new meeting - only one bot should attend
4. Run `check-duplicate-bots.js` periodically to verify no duplicates


# Bot Scheduling Fix

## Issues Found

1. **Invalid `join_at` format**: The bot config was sending `join_at` as an object `{minutes_before_start: 1}`, but Recall.ai API expects an ISO8601 datetime string.

2. **Events in the past**: Some bot scheduling attempts were failing because events had already ended.

3. **Missing error logging**: Errors from Recall API weren't being fully logged for debugging.

## Fixes Applied

### 1. Fixed `join_at` Format

**Before:**
```javascript
botConfig.join_at = {
  minutes_before_start: calendar.joinBeforeStartMinutes,
};
```

**After:**
```javascript
// Calculate join_at as ISO8601 datetime string
const joinBeforeStartMinutes = calendar?.joinBeforeStartMinutes || 1;
const joinAtTime = new Date(event.startTime);
joinAtTime.setMinutes(joinAtTime.getMinutes() - Math.max(joinBeforeStartMinutes, 10));
botConfig.join_at = joinAtTime.toISOString();
```

### 2. Added Event Validation

Added check to skip bot scheduling for events that have already started or ended:
```javascript
if (event.startTime <= new Date()) {
  console.warn(`[BOT_CONFIG] Event ${event.id} has already started or ended. Skipping bot scheduling.`);
  return;
}
```

### 3. Improved Error Logging

Added detailed error logging to help diagnose API failures:
```javascript
try {
  updatedEventFromRecall = await Recall.addBotToCalendarEvent({...});
} catch (error) {
  console.error(`[BOT_CONFIG] Failed to schedule bot for event ${event.id}:`, error.message);
  if (error.res) {
    const errorBody = await error.res.text().catch(() => 'Unable to read error body');
    console.error(`[BOT_CONFIG] Recall API error response:`, errorBody);
  }
  throw error;
}
```

## Testing

After deployment, check logs for:
- `[BOT_CONFIG] Event start: ... join_at: ...` - Should show ISO8601 datetime
- `[BOT_CONFIG] Bot scheduled successfully` - Should appear for future events
- No more `join_at` format errors

## Next Steps

1. Wait for deployment to complete
2. Check worker logs for bot scheduling activity
3. Create a test meeting with a meeting URL
4. Verify bot is scheduled and appears in Recall.ai dashboard

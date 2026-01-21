# Shared Bot Scheduling for Company Users

## Overview

When multiple users from the same company attend the same meeting, the system now coordinates bot scheduling so that only **one bot** records the meeting, and all users from the same company can access the recording and transcript.

## How It Works

### 1. Company Detection

The system identifies users from the same company by their email domain:
- ✅ `alice@company.com` and `bob@company.com` → Same company
- ❌ `alice@gmail.com` and `bob@company.com` → Different (personal email)
- ❌ `alice@gmail.com` and `bob@gmail.com` → Different (personal emails)

**Personal domains** (gmail.com, outlook.com, etc.) are excluded from sharing.

### 2. Meeting Matching

Meetings are matched by their **normalized meeting URL**:
- Same meeting URL = Same meeting
- URLs are normalized (removed query params, fragments, case-insensitive)

### 3. Bot Scheduling Coordination

When scheduling a bot:

1. **Check for existing bot**: Before scheduling, the system checks if another user from the same company already has a bot scheduled for the same meeting URL
2. **Use shared deduplication key**: If a shared bot exists (or for coordination), uses a shared deduplication key: `shared-bot-{company-domain}-{normalized-url}`
3. **Recall API handles sharing**: The Recall API uses the deduplication key to ensure only one bot is created per meeting URL + company combination

### 4. Deduplication Key Strategy

- **Shared meetings**: `shared-bot-{company-domain}-{normalized-url}`
- **Personal meetings**: `recall-event-{recallEventId}` (fallback)

## Benefits

✅ **Cost savings**: Only one bot per meeting, not one per user  
✅ **Better coordination**: All company users see the same recording  
✅ **Automatic**: Works transparently - no configuration needed  
✅ **Backward compatible**: Personal emails still work independently  

## Example Scenario

**Company: Acme Corp (acme.com)**

1. **Alice** (`alice@acme.com`) creates a meeting with Zoom URL: `https://zoom.us/j/123456789`
2. Bot is scheduled with key: `shared-bot-acme-com-https-zoom-us-j-123456789`
3. **Bob** (`bob@acme.com`) is invited to the same meeting
4. When Bob's calendar syncs, the system detects:
   - Same company domain (`acme.com`)
   - Same meeting URL (`https://zoom.us/j/123456789`)
   - Existing bot already scheduled
5. Bob's event uses the **same deduplication key**, so Recall API reuses the existing bot
6. **Result**: Only one bot attends, both Alice and Bob see the recording

## Configuration

No configuration needed! The feature is automatic and works based on:
- Email domain detection
- Meeting URL matching
- Recall API deduplication keys

## Limitations

1. **Personal emails**: Users with personal email domains (gmail.com, etc.) don't share bots
2. **Different companies**: Users from different companies don't share bots
3. **Meeting URL required**: Meetings must have a meeting URL (Zoom, Teams, Google Meet, etc.)
4. **Future meetings only**: Only checks for shared bots in future meetings

## Technical Details

### Files Modified

- ✅ `recall/utils/shared-bot-scheduling.js` (new) - Shared bot detection logic
- ✅ `recall/worker/processors/calendar-event-update-bot-schedule.js` - Integrated shared bot check

### Key Functions

- `normalizeMeetingUrl(url)` - Normalizes meeting URLs for comparison
- `extractCompanyDomain(email)` - Extracts company domain, excludes personal domains
- `checkForSharedBot(meetingUrl, userId, userEmail)` - Checks if shared bot exists
- `getSharedDeduplicationKey(meetingUrl, userEmail)` - Generates shared deduplication key

## Future Enhancements

Potential improvements:
1. **Manual organization assignment**: Allow users to manually specify their organization
2. **Artifact sharing**: Link meeting artifacts to multiple users from the same company
3. **Cross-company sharing**: Allow sharing between trusted companies
4. **Admin controls**: Let admins configure sharing policies

## Testing

To test shared bot scheduling:

1. Create two users with emails from the same company domain
2. Connect calendars for both users
3. Create a meeting with the same meeting URL for both users
4. Check logs for `[SHARED-BOT]` messages
5. Verify only one bot is scheduled in Recall API


# Why Calendar Shows "null" Email and "connecting" Status

## The Issue

When you connect a calendar, you see:
- **Email**: `null` (instead of your email address)
- **Status**: `connecting` (instead of `connected`)

## Why This Happens

### Initial State (What You're Seeing)

When a calendar is first created in Recall, the API returns:
```json
{
  "platform_email": null,
  "status": "connecting"
}
```

This is **expected behavior** because:

1. **Recall needs time to process**: After you authorize OAuth, Recall needs to:
   - Verify the OAuth tokens are valid
   - Connect to Google Calendar/Microsoft Outlook API
   - Fetch your calendar information (including email)
   - Set up webhooks

2. **This happens asynchronously**: The calendar creation is immediate, but the verification happens in the background.

### How It Gets Updated

Once Recall finishes processing, it sends a webhook to your application:
- **Webhook URL**: `https://recall-v2-demo-production.up.railway.app/webhooks/recall-calendar-updates`
- **Event**: `calendar.update`

Your application then:
1. Receives the webhook
2. Queues a background job (`recall.calendar.update`)
3. Fetches the updated calendar data from Recall API
4. Updates the database with the new status and email

### The Problem: Worker Service Not Running

For the webhook to update the calendar status, you need a **worker service** running to process background jobs. The worker:
- Processes webhook events
- Fetches updated calendar data from Recall
- Updates the database

**If the worker isn't running, the calendar will stay in "connecting" state forever!**

## Solution: Set Up Worker Service

You need to create a worker service in Railway:

1. **In Railway Dashboard:**
   - Go to your project
   - Click **"+ New"** → **"Empty Service"** (or duplicate your main service)
   - Name it: `v2-demo-worker` (or similar)
   - Set **Start Command**: `npm run start:worker`
   - Make sure it has the same environment variables as the main service

2. **Verify Worker is Running:**
   ```bash
   railway logs --service v2-demo-worker --tail 50
   ```

   You should see:
   - `INFO: Database connection established.`
   - Job processing messages

3. **Check for Webhook Processing:**
   ```bash
   railway logs --tail 100 | grep -i "webhook\|calendar.update"
   ```

## Expected Flow

1. ✅ User clicks "Connect" → OAuth flow completes
2. ✅ Calendar created in Recall → Status: "connecting", Email: null
3. ⏳ Recall processes calendar (takes a few seconds to minutes)
4. ✅ Recall sends webhook → `calendar.update` event
5. ✅ Worker processes webhook → Fetches updated calendar data
6. ✅ Database updated → Status: "connected", Email: your-email@example.com

## Troubleshooting

**If calendar stays "connecting":**
- Check if worker service exists and is running
- Check worker logs for errors
- Verify webhook URL is accessible: `https://recall-v2-demo-production.up.railway.app/webhooks/recall-calendar-updates`
- Check if Redis is working (worker needs Redis)

**If email stays null:**
- Same as above - worker needs to process the webhook
- Check Recall API to see if calendar has email: `railway logs | grep "platform_email"`


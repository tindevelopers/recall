# Webhook Troubleshooting Guide

If webhooks are not firing, follow these steps to diagnose and fix the issue.

## Quick Diagnosis

### Step 1: Check Webhook Configuration

Use the debug endpoint to check webhook configuration:

```bash
# Replace <calendar-id> with your actual calendar UUID
curl "https://your-app.up.railway.app/api/debug-webhooks?calendarId=<calendar-id>"
```

This will show:
- Current webhook URL configured in Recall.ai
- Expected webhook URL based on PUBLIC_URL
- Recent webhooks received
- Diagnostic issues and recommendations

### Step 2: Verify PUBLIC_URL is Set

Check that `PUBLIC_URL` environment variable is set correctly:

```bash
# In Railway dashboard or via CLI
railway variables

# Or check logs
railway logs | grep PUBLIC_URL
```

The `PUBLIC_URL` should be your full app URL (e.g., `https://your-app.up.railway.app`).

### Step 3: Check Webhook Endpoint is Accessible

Test if the webhook endpoint is accessible:

```bash
curl -X POST https://your-app.up.railway.app/webhooks/recall-calendar-updates \
  -H "Content-Type: application/json" \
  -d '{"event":"test","data":{"calendar_id":"test"}}'
```

You should get a 200 response (even if the calendar doesn't exist, it returns 200 to prevent retries).

### Step 4: Check Application Logs

Look for webhook-related log messages:

```bash
railway logs | grep -i webhook
```

You should see:
- `[WEBHOOK] Received request` - when webhooks arrive
- `[WEBHOOK] Processing` - when webhooks are being processed
- `[WEBHOOK] Queued job` - when background jobs are queued

## Common Issues and Solutions

### Issue 1: PUBLIC_URL Not Set or Incorrect

**Symptoms:**
- Webhook URL in Recall.ai is incorrect or missing
- Debug endpoint shows `webhookUrlMatches: false`

**Solution:**
1. Set `PUBLIC_URL` environment variable:
   ```bash
   railway variables set PUBLIC_URL=https://your-app.up.railway.app
   ```
2. Update webhook URL for existing calendars:
   ```bash
   curl -X POST https://your-app.up.railway.app/api/update-webhook-url \
     -H "Content-Type: application/json" \
     -d '{"calendarId":"<your-calendar-id>"}'
   ```

### Issue 2: Webhook URL Mismatch

**Symptoms:**
- Debug endpoint shows `webhookUrlMatches: false`
- Recall.ai has old webhook URL

**Solution:**
Update the webhook URL using the API endpoint:

```bash
curl -X POST https://your-app.up.railway.app/api/update-webhook-url \
  -H "Content-Type: application/json" \
  -d '{"calendarId":"<your-calendar-id>"}'
```

Or reconnect the calendar through the OAuth flow (this will automatically update the webhook URL).

### Issue 3: No Webhooks Received

**Symptoms:**
- Debug endpoint shows `count: 0` for recent webhooks
- Calendar status stuck at "connecting"

**Possible Causes:**
1. **Webhook URL not configured in Recall.ai**
   - Solution: Update webhook URL (see Issue 2)

2. **Recall.ai hasn't processed the calendar yet**
   - Wait a few minutes after connecting the calendar
   - Check Recall.ai dashboard to see if calendar is connected

3. **Webhook endpoint not accessible**
   - Check if your app is running and accessible
   - Verify firewall/network settings
   - Test with curl (see Step 3 above)

4. **Worker service not running**
   - Webhooks are received but not processed if worker is down
   - Check worker service status in Railway dashboard
   - Verify worker logs show job processing

### Issue 4: Webhooks Received But Not Processed

**Symptoms:**
- Webhooks appear in database but calendar status doesn't update
- Logs show webhook received but no job processing

**Solution:**
1. Check worker service is running:
   ```bash
   railway status
   ```

2. Check worker logs:
   ```bash
   railway logs --service worker
   ```

3. Verify Redis connection:
   - Check `REDIS_URL` is set
   - Verify Redis service is running in Railway

## Manual Webhook URL Update

If you need to manually update the webhook URL for a calendar:

### Option 1: Use API Endpoint

```bash
curl -X POST https://your-app.up.railway.app/api/update-webhook-url \
  -H "Content-Type: application/json" \
  -d '{"calendarId":"<calendar-uuid>"}'
```

### Option 2: Reconnect Calendar

1. Go to your app's calendar settings
2. Disconnect the calendar
3. Reconnect the calendar (this will set the correct webhook URL)

### Option 3: Update via Recall API Directly

If you have direct access to Recall API:

```bash
curl -X PATCH https://api.recall.ai/api/v2/calendars/<recall-calendar-id>/ \
  -H "Authorization: Bearer <your-recall-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://your-app.up.railway.app/webhooks/recall-calendar-updates"}'
```

## Verification Checklist

- [ ] `PUBLIC_URL` environment variable is set correctly
- [ ] Webhook endpoint is accessible (test with curl)
- [ ] Webhook URL in Recall.ai matches expected URL (check via debug endpoint)
- [ ] Worker service is running and processing jobs
- [ ] Redis is connected and working
- [ ] Application logs show webhook activity
- [ ] Recent webhooks appear in database (check via debug endpoint)

## Debug Endpoints

### Check Webhook Configuration
```
GET /api/debug-webhooks?calendarId=<uuid>
```

### Update Webhook URL
```
POST /api/update-webhook-url
Body: { "calendarId": "<uuid>" }
```

## Additional Resources

- See `EXPLAIN-CALENDAR-STATUS.md` for details on calendar status flow
- See `WORKER-REQUIREMENTS.md` for worker service setup
- See `RAILWAY-SERVERLESS-CONFIG.md` for serverless configuration

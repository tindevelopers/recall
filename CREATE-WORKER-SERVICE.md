# Create Worker Service Using Railway CLI

## Step-by-Step Guide

### Step 1: Create the Worker Service

Run this command in your terminal:

```bash
cd /Users/gene/Projects/recall
railway add --service recall-worker
```

When prompted:
1. **What do you need?** → Select **"Empty Service"**
2. **Enter a service name** → Type: `recall-worker` (or press Enter to use default)
3. **Enter a variable** → Press Enter to skip (we'll configure via dashboard)

### Step 2: Configure the Worker Service

After creating the service, you need to configure it in the Railway dashboard:

1. **Go to Railway Dashboard:**
   - Open: https://railway.app
   - Navigate to your project: `recall-recall`
   - Click on the `recall-worker` service

2. **Set Start Command:**
   - Go to **Settings** → **Deploy**
   - Find **"Start Command"** field
   - Set it to: `npm run start:worker`
   - Save changes

3. **Copy Environment Variables:**
   - The worker needs the same environment variables as the main service
   - Go to **Variables** tab
   - Copy these variables from your main service (`recall-recall`):
     - `DATABASE_URL`
     - `REDIS_URL`
     - `RECALL_API_KEY`
     - `RECALL_API_HOST`
     - `SECRET`
     - `PUBLIC_URL`
     - `PORT` (optional, defaults to 3003)
     - `NODE_ENV` (should be `production`)
     - `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` (if using Google Calendar)
     - `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` (if using Google Calendar)
     - `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` (if using Microsoft Outlook)
     - `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` (if using Microsoft Outlook)

   **Quick way:** In Railway dashboard, you can click "Copy from another service" and select `recall-recall`

4. **Set Root Directory (if needed):**
   - If Railway doesn't detect it automatically, set **Root Directory** to: `recall`
   - Or leave as root if using `railway.toml`

### Step 3: Deploy the Worker

The worker will automatically deploy after you save the start command. Or manually trigger:

```bash
railway up --service recall-worker
```

### Step 4: Verify Worker is Running

Check the logs:

```bash
railway logs --service recall-worker --tail 50
```

You should see:
- `INFO: Database connection established.`
- `INFO: Database migrations synced.`
- Job processing messages (when webhooks are received)

### Step 5: Test Webhook Processing

After the worker is running, your calendars should update automatically:
- Status should change from "connecting" → "connected"
- Email should populate (no longer null)

Check main app logs for webhook activity:
```bash
railway logs --tail 100 | grep -i "webhook\|calendar.update"
```

## Troubleshooting

**Worker not starting:**
- Check logs: `railway logs --service recall-worker`
- Verify start command is set: `npm run start:worker`
- Ensure all environment variables are set

**Worker not processing jobs:**
- Verify Redis is accessible (check `REDIS_URL`)
- Check worker logs for Redis connection errors
- Ensure worker service has same `REDIS_URL` as main service

**Calendars still showing "connecting":**
- Wait a few minutes for Recall to process
- Check if webhooks are being received: `railway logs --tail 100 | grep webhook`
- Verify worker is processing jobs: `railway logs --service recall-worker --tail 50`





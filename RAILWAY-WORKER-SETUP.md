# Railway Worker Service Setup - Calendar Sync Fix

## Problem Identified

**Root Cause**: Worker service `recall-worker` does not exist on Railway.

**Evidence:**
- ✅ REDIS_URL is configured: `redis://...@redis.railway.internal:6379`
- ❌ Worker service `recall-worker` not found
- ❌ Without worker service, periodic sync cannot run
- ❌ Calendar events are not being synced

## Solution: Create Worker Service on Railway

### Step 1: Check Current Services

In Railway dashboard:
1. Go to: https://railway.app
2. Open project: `recall-v2-demo`
3. Check what services exist (should see main service, but no worker)

### Step 2: Create Worker Service

**Option A: Via Railway Dashboard (Recommended)**

1. In Railway dashboard, click **"+ New"** → **"Empty Service"**
2. Name it: `recall-worker`
3. Connect to the same GitHub repository as your main service
4. Set **Root Directory**: Leave as root (or set to `recall` if needed)
5. Set **Start Command**: `npm run start:worker`
6. Copy environment variables from main service:
   - Go to main service → **Variables** tab
   - Copy all variables (especially `REDIS_URL`, `DATABASE_URL`, `RECALL_API_KEY`, etc.)
   - Go to worker service → **Variables** tab
   - Paste all variables

**Option B: Via Railway CLI**

```bash
cd /Users/gene/Projects/recall
railway add --service recall-worker
```

Then configure in dashboard:
- Set Start Command: `npm run start:worker`
- Copy environment variables from main service

### Step 3: Verify Worker is Running

After deployment, check logs:

```bash
railway logs --service recall-worker --tail 50
```

**Look for these success indicators:**
- ✅ `INFO: Database connection established.`
- ✅ `✅ Redis connection established - Queue is ready`
- ✅ `⏰ Scheduled periodic calendar sync (every 2 minutes)`
- ✅ `🔄 Triggered initial calendar sync`
- ✅ `[PERIODIC-SYNC] Starting periodic calendar sync...`

**If you see errors:**
- ❌ `ECONNREFUSED` → Redis connection issue (check REDIS_URL)
- ❌ `Server ready at http://0.0.0.0:3003` → Wrong start command (should be `npm run start:worker`)
- ❌ `DATABASE_URL not set` → Copy environment variables from main service

### Step 4: Verify Calendar Sync is Working

1. **Wait 2-3 minutes** for periodic sync to run
2. **Check logs for sync activity:**
   ```bash
   railway logs --service recall-worker --tail 100 | grep -i "periodic\|sync\|gene"
   ```
3. **Create a test meeting** in gene@tin.info calendar
4. **Wait 2-3 minutes** and check if it appears in your app

### Step 5: Monitor Sync Activity

The instrumentation we added will log:
- When periodic sync runs
- When gene@tin.info calendar is processed
- Events fetched from Recall API
- Events created/updated in database

Check logs:
```bash
railway logs --service recall-worker --tail 200 | grep -E "PERIODIC-SYNC|gene|calendar"
```

## Expected Behavior After Fix

Once worker service is running:
- ✅ Worker connects to Redis successfully
- ✅ Periodic sync runs every 2 minutes
- ✅ New calendar events are synced automatically
- ✅ Webhook-triggered syncs also work
- ✅ Bot scheduling jobs are processed

## Troubleshooting

**Worker not starting:**
- Check start command is `npm run start:worker`
- Verify all environment variables are copied
- Check Railway logs for errors

**Redis connection errors:**
- Verify REDIS_URL is set in worker service
- Ensure Redis service is running in Railway
- Check if REDIS_URL matches main service

**Periodic sync not running:**
- Check if Redis is connected (look for "Queue is ready")
- Verify worker logs show "Scheduled periodic calendar sync"
- Wait 2-3 minutes for first sync to run


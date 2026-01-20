# Create Railway Worker Service - Step by Step

## Current Status
- ✅ REDIS_URL is configured
- ✅ Code is ready (with instrumentation)
- ❌ Worker service `recall-worker` does NOT exist

## Step-by-Step Instructions

### Step 1: Create Worker Service in Railway Dashboard

1. **Go to Railway Dashboard:**
   - Open: https://railway.app
   - Navigate to project: `recall-v2-demo`

2. **Create New Service:**
   - Click **"+ New"** button (top right)
   - Select **"Empty Service"**
   - Name it: `recall-worker`
   - Click **Create**

### Step 2: Connect to GitHub Repository

1. In the `recall-worker` service:
   - Go to **Settings** → **Source**
   - Click **"Connect GitHub Repo"**
   - Select the same repository as your main service (`recall-v2-demo`)
   - Railway will automatically detect the code

### Step 3: Configure Start Command

1. Go to **Settings** → **Deploy**
2. Find **"Custom Start Command"** field
3. Set it to: `npm run start:worker`
4. Click **Save** (this triggers deployment)

### Step 4: Copy Environment Variables

1. Go to your **main service** (`recall-v2-demo`)
2. Click **Variables** tab
3. Click **"Copy from another service"** OR manually copy these variables:
   - `DATABASE_URL`
   - `REDIS_URL` ⚠️ **CRITICAL - Must be set**
   - `RECALL_API_KEY`
   - `RECALL_API_HOST`
   - `SECRET`
   - `PUBLIC_URL`
   - `NODE_ENV` (should be `production`)
   - Any OAuth credentials you're using

4. Go to **worker service** (`recall-worker`)
5. Click **Variables** tab
6. Paste all variables (or use "Copy from another service")

### Step 5: Set Root Directory (if needed)

1. In worker service → **Settings** → **Deploy**
2. **Root Directory**: Leave as root (default) OR set to `recall` if Railway doesn't detect it
3. The updated `Dockerfile.worker` handles both cases

### Step 6: Wait for Deployment

- Railway will automatically build and deploy
- Wait 2-3 minutes for deployment to complete

### Step 7: Verify Worker is Running

Run this command:
```bash
railway logs --service recall-worker --tail 50
```

**Look for these SUCCESS indicators:**
- ✅ `INFO: Database connection established.`
- ✅ `✅ Redis connection established - Queue is ready`
- ✅ `⏰ Scheduled periodic calendar sync (every 2 minutes)`
- ✅ `🔄 Triggered initial calendar sync`
- ✅ `[PERIODIC-SYNC] Starting periodic calendar sync...`

**If you see ERRORS:**
- ❌ `ECONNREFUSED` → Redis connection issue (check REDIS_URL)
- ❌ `Server ready at http://0.0.0.0:3003` → Wrong start command (should be `npm run start:worker`)
- ❌ `DATABASE_URL not set` → Copy environment variables

### Step 8: Verify Calendar Sync is Working

1. **Wait 2-3 minutes** for periodic sync to run
2. **Check logs for sync activity:**
   ```bash
   railway logs --service recall-worker --tail 100 | grep -i "periodic\|sync\|gene"
   ```
3. **Create a test meeting** in gene@tin.info calendar
4. **Wait 2-3 minutes** and check if it appears in your app

## Quick Verification Script

After creating the service, run:
```bash
cd /Users/gene/Projects/recall
node recall/verify-railway-worker-setup.js
```

This will check:
- ✅ Worker service exists
- ✅ REDIS_URL is configured
- ✅ Worker logs show Redis connection
- ✅ Periodic sync is scheduled

## Expected Behavior After Setup

Once worker service is running:
- ✅ Worker connects to Redis successfully
- ✅ Periodic sync runs every 2 minutes
- ✅ New calendar events are synced automatically
- ✅ Webhook-triggered syncs also work
- ✅ Bot scheduling jobs are processed

## Troubleshooting

**Worker service not found:**
- Verify you created it in Railway dashboard
- Check service name is exactly `recall-worker`
- Try: `railway service` to list all services

**Redis connection errors:**
- Verify REDIS_URL is copied to worker service
- Check Redis service is running in Railway
- Ensure REDIS_URL matches main service

**Periodic sync not running:**
- Check if Redis is connected (look for "Queue is ready")
- Verify worker logs show "Scheduled periodic calendar sync"
- Wait 2-3 minutes for first sync to run


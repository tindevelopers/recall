# Verify Railway Setup - All Systems Check

## Quick Verification Checklist

### ✅ Main Service Status
- **Service**: `recall-v2-demo`
- **Status**: ✅ Deployed (just redeployed)
- **Environment Variables**: ✅ REDIS_URL, DATABASE_URL, RECALL_API_KEY configured

### ⚠️ Worker Service Status
- **Service**: `recall-worker`
- **Status**: ❓ Needs verification

## Verification Steps

### Step 1: Check Worker Service Exists

**Via Railway Dashboard:**
1. Go to: https://railway.app
2. Open project: `recall-v2-demo`
3. Check if `recall-worker` service exists in the services list

**Via CLI (if service exists):**
```bash
railway service recall-worker
railway logs --service recall-worker --tail 50
```

### Step 2: Verify Worker Configuration

If worker service exists, check:

1. **Start Command:**
   - Should be: `npm run start:worker`
   - Check in: Settings → Deploy → Custom Start Command

2. **Environment Variables:**
   - Must have: `REDIS_URL` (critical!)
   - Must have: `DATABASE_URL`
   - Must have: `RECALL_API_KEY`
   - Should match main service variables

3. **Root Directory:**
   - Should be: root (or `recall` if needed)
   - Check in: Settings → Deploy → Root Directory

### Step 3: Check Worker Logs

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
- ❌ `ECONNREFUSED` → Redis connection issue
- ❌ `Server ready at http://0.0.0.0:3003` → Wrong start command
- ❌ `DATABASE_URL not set` → Missing environment variables

### Step 4: Verify Calendar Sync is Working

1. **Wait 2-3 minutes** for periodic sync to run
2. **Check logs for sync activity:**
   ```bash
   railway logs --service recall-worker --tail 100 | grep -i "periodic\|sync\|gene"
   ```
3. **Create a test meeting** in gene@tin.info calendar
4. **Wait 2-3 minutes** and verify it appears in your app

## If Worker Service Doesn't Exist

Follow instructions in `CREATE-WORKER-SERVICE-NOW.md`:
1. Create worker service in Railway dashboard
2. Set Start Command: `npm run start:worker`
3. Copy all environment variables from main service
4. Wait for deployment
5. Verify logs show Redis connection and periodic sync

## Expected Behavior When Working

- ✅ Worker connects to Redis successfully
- ✅ Periodic sync runs every 2 minutes
- ✅ New calendar events sync automatically
- ✅ Webhook-triggered syncs work
- ✅ Bot scheduling jobs are processed

## Troubleshooting Commands

```bash
# Check Railway status
railway status

# Check environment variables
railway variables

# Check main service logs
railway logs --tail 50

# Check worker service logs (if exists)
railway logs --service recall-worker --tail 50

# Redeploy main service
railway up

# Redeploy worker service (if exists)
railway up --service recall-worker
```


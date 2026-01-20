# Verify Worker Service After Linking

## Quick Verification Steps

### Step 1: Link to Worker Service

First, link to the worker service using its exact name from Railway dashboard:

```bash
railway service <exact-service-name>
```

Common names:
- `recall-worker`
- `v2-worker`  
- `worker`
- Or check Railway dashboard for exact name

### Step 2: Check Worker Logs

After linking, check logs:

```bash
railway logs --service <service-name> --tail 50
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

### Step 3: Verify Shared Resources

Check that worker shares same Redis and Database as main service:

```bash
# Check main service REDIS_URL
railway variables | grep REDIS_URL

# Check worker service REDIS_URL  
railway variables --service <service-name> | grep REDIS_URL

# They should match (point to same Redis instance)
```

### Step 4: Verify Periodic Sync is Running

Wait 2-3 minutes, then check for sync activity:

```bash
railway logs --service <service-name> --tail 100 | grep -i "periodic\|sync\|gene"
```

You should see:
- `[PERIODIC-SYNC] Starting periodic calendar sync...`
- `[PERIODIC-SYNC] Found X connected calendar(s)`
- `[PERIODIC-SYNC] Syncing calendar...`
- Logs mentioning `gene@tin.info` when that calendar is processed

### Step 5: Test Calendar Sync

1. Create a test meeting in gene@tin.info calendar
2. Wait 2-3 minutes
3. Check if it appears in your app
4. Check worker logs for sync activity

## Automated Verification

After linking, run:

```bash
cd /Users/gene/Projects/recall
node recall/check-worker-connection.js
```

This will automatically check:
- ✅ Worker service exists and is linked
- ✅ Redis connection status
- ✅ Periodic sync scheduling
- ✅ Environment variables match

## Expected Behavior When Working

- ✅ Worker connects to Redis successfully
- ✅ Periodic sync runs every 2 minutes
- ✅ New calendar events sync automatically
- ✅ gene@tin.info calendar events appear in app
- ✅ Bot scheduling jobs are processed

## Troubleshooting

**Can't link to service:**
- Verify exact service name in Railway dashboard
- Try: `railway service` to see available services
- Service must exist in same project

**Redis connection errors:**
- Verify REDIS_URL is set in worker service
- Check REDIS_URL matches main service
- Ensure Redis service is running

**Periodic sync not running:**
- Check Redis is connected (look for "Queue is ready")
- Verify worker logs show "Scheduled periodic calendar sync"
- Wait 2-3 minutes for first sync to run


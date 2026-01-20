# Redis Connection Issue - Calendar Sync Not Working

## Problem Identified

The worker cannot sync calendar events because **Redis is not connected**. 

### Evidence from Logs:
- Multiple `ECONNREFUSED 127.0.0.1:6379` errors
- The `backgroundQueue.on("ready")` event never fires
- Periodic sync job is never scheduled
- Without periodic sync, new calendar events are not synced

### Root Cause:
The periodic sync job is only scheduled when Redis connects successfully. Without Redis:
1. Worker starts but cannot connect to Redis
2. Queue "ready" event never fires
3. Periodic sync job is never scheduled
4. New calendar events are not synced

## Fix for Local Development

### Option 1: Install Redis via Homebrew (Recommended)
```bash
brew install redis
brew services start redis
```

### Option 2: Use Docker
```bash
docker run -d --name redis-local -p 6379:6379 redis:6.2-alpine
```

### Option 3: Use Railway Redis URL
If you have a Railway Redis instance, set the `REDIS_URL` environment variable:
```bash
export REDIS_URL="redis://your-railway-redis-url"
```

## Fix for Production (Railway)

1. **Check if Redis service exists:**
   ```bash
   railway service
   ```
   Look for a Redis service or check if `REDIS_URL` is set in environment variables.

2. **If Redis service doesn't exist:**
   - Add a Redis service in Railway dashboard
   - Copy the `REDIS_URL` from the Redis service
   - Add `REDIS_URL` to the worker service environment variables

3. **Verify worker can connect:**
   ```bash
   railway logs --service recall-worker --tail 100
   ```
   Look for:
   - ✅ `Redis connection established - Queue is ready`
   - ✅ `Scheduled periodic calendar sync (every 2 minutes)`
   - ✅ `Triggered initial calendar sync`

## Verification

After fixing Redis connection:

1. **Restart the worker** (if running locally)
2. **Check logs for:**
   - `✅ Redis connection established - Queue is ready`
   - `⏰ Scheduled periodic calendar sync (every 2 minutes)`
   - `🔄 Triggered initial calendar sync`
   - `[PERIODIC-SYNC] Starting periodic calendar sync...`

3. **Wait 2-3 minutes** and check if periodic sync runs:
   ```bash
   # Check debug log
   cat .cursor/debug.log | jq -r 'select(.message | contains("periodic") or contains("gene"))'
   
   # Or check Railway logs
   railway logs --service recall-worker --tail 50 | grep -i "periodic\|sync\|gene"
   ```

4. **Verify new events are synced:**
   - Create a test meeting in gene@tin.info calendar
   - Wait 2-3 minutes
   - Check if it appears in the database

## Expected Behavior After Fix

Once Redis is connected:
- ✅ Worker connects to Redis successfully
- ✅ Periodic sync job is scheduled (runs every 2 minutes)
- ✅ Initial sync runs immediately
- ✅ New calendar events are synced automatically
- ✅ Webhook-triggered syncs also work


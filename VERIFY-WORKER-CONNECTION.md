# Verify Worker Service Connection

## Current Status

The worker service exists in Railway but isn't accessible via CLI. This is normal - you need to link to it first.

## Step 1: Find Worker Service Name

1. Go to Railway Dashboard: https://railway.app
2. Open project: `recall-v2-demo`
3. Look for the worker service in the services list
4. Note the exact service name (might be `recall-worker`, `v2-worker`, or something else)

## Step 2: Link to Worker Service via CLI

Once you know the service name, link to it:

```bash
railway service <service-name>
```

For example:
```bash
railway service recall-worker
# OR
railway service v2-worker
```

## Step 3: Verify Worker is Connected

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
- ❌ `ECONNREFUSED` → Redis connection issue (check REDIS_URL)
- ❌ `Server ready at http://0.0.0.0:3003` → Wrong start command (should be `npm run start:worker`)
- ❌ `DATABASE_URL not set` → Missing environment variables

## Step 4: Verify Shared Resources

The worker must share the same resources as main service:

1. **Same Redis Instance:**
   - Check REDIS_URL matches between services
   - Both should point to same Redis instance
   - Verify in Railway dashboard: Variables tab

2. **Same Database:**
   - Check DATABASE_URL matches between services
   - Both should point to same PostgreSQL database
   - Verify in Railway dashboard: Variables tab

3. **Same API Keys:**
   - RECALL_API_KEY should match
   - RECALL_API_HOST should match

## Step 5: Verify Calendar Sync is Working

1. **Wait 2-3 minutes** for periodic sync to run
2. **Check logs for sync activity:**
   ```bash
   railway logs --service <service-name> --tail 100 | grep -i "periodic\|sync\|gene"
   ```
3. **Create a test meeting** in gene@tin.info calendar
4. **Wait 2-3 minutes** and verify it appears in your app

## Quick Verification Script

After linking to the worker service, run:

```bash
cd /Users/gene/Projects/recall
node recall/check-worker-connection.js
```

This will check:
- ✅ Worker service exists and is linked
- ✅ Redis connection status
- ✅ Periodic sync scheduling
- ✅ Environment variables match main service

## Troubleshooting

**Worker service not found:**
- Verify service name in Railway dashboard
- Try linking: `railway service <exact-service-name>`
- Check if service is in same project

**Redis connection errors:**
- Verify REDIS_URL is set in worker service
- Check REDIS_URL matches main service
- Ensure Redis service is running in Railway

**Worker running main app:**
- Check Start Command is: `npm run start:worker`
- Verify in Railway dashboard: Settings → Deploy → Custom Start Command
- Redeploy after changing start command


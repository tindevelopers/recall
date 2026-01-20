# Link and Test Worker Service

## Step 1: Link to Worker Service via Railway CLI

The Railway CLI requires interactive prompts, so run this command manually:

```bash
cd /Users/gene/Projects/recall
railway service v2-demo-worker
```

**If the service name is different**, Railway will show you a list of available services. Select the worker service.

**Alternative:** If you don't know the exact service name:
1. Go to Railway Dashboard: https://railway.app
2. Open your project: `recall-v2-demo`
3. Find the worker service (it should be separate from the main service)
4. Note the exact service name

## Step 2: Verify Worker Logs

Once linked, check the worker logs:

```bash
railway logs --service v2-demo-worker --tail 50
```

**Look for these success indicators:**
- ✅ `Database connection established`
- ✅ `Redis connection established - Queue is ready`
- ✅ `Scheduled periodic calendar sync (every 2 minutes)`
- ✅ `Triggered initial calendar sync`
- ✅ `All job processors registered`

**Red flags (problems):**
- ❌ `ECONNREFUSED 127.0.0.1:6379` → Redis not connected
- ❌ `Database connection failed` → Database URL incorrect
- ❌ `Server ready at http://0.0.0.0:3003` → Wrong start command (running main app instead of worker)

## Step 3: Run Connection Test

After linking, run the automated test:

```bash
node recall/test-worker-connection.js
```

This will test:
1. Redis connection (shared queue)
2. Database connection (shared database)
3. Queue job processing capability
4. Calendar sync status
5. gene@tin.info calendar status

## Step 4: Verify Worker is Processing Jobs

Check if the worker is processing calendar sync jobs:

```bash
railway logs --service v2-demo-worker --tail 100 | grep -i "periodic\|sync\|gene"
```

You should see:
- `[PERIODIC-SYNC] Starting periodic calendar sync...`
- `[PERIODIC-SYNC] Found X connected calendars`
- `[PERIODIC-SYNC] Synced calendar events for calendar(...)`

## Troubleshooting

### Service Not Found
If `railway service recall-worker` says "Service not found":
1. Check Railway dashboard for exact service name
2. The service might be named differently (e.g., `v2-worker`, `recall-worker-v2`)
3. Make sure you're in the correct Railway project

### Redis Connection Failed
If you see `ECONNREFUSED` errors:
1. Verify `REDIS_URL` is set in worker service environment variables
2. Ensure `REDIS_URL` matches the main service's `REDIS_URL`
3. Check that Redis service is running in Railway

### Database Connection Failed
If database connection fails:
1. Verify `DATABASE_URL` is set in worker service environment variables
2. Ensure `DATABASE_URL` matches the main service's `DATABASE_URL`
3. Check database service is running in Railway

### Wrong Start Command
If you see "Server ready" messages:
1. Go to Railway Dashboard → Worker Service → Settings → Deploy
2. Set **Custom Start Command** to: `npm run start:worker`
3. Save and wait for redeployment

## Success Criteria

✅ Worker service is linked via CLI  
✅ Worker logs show Redis and database connected  
✅ Connection test passes all checks  
✅ Worker is processing periodic sync jobs  
✅ gene@tin.info calendar events are syncing  


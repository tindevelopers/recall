# Update Worker Start Command

## Status

✅ **Changes pushed to GitHub:**
- Updated `railway.toml` with comment about worker service
- Committed and pushed to `main` branch

## Current Issue

The worker service is still running `npm start` (main app) instead of `npm run start:worker`.

**Why:** Railway reads `railway.toml` from the root directory, and both services (main app and worker) use the same file. Railway doesn't support service-specific start commands in a single `railway.toml` file.

## Solution: Dashboard Override Required

Since Railway CLI doesn't support setting start commands directly, you **must** set it in the Railway dashboard:

### Steps:

1. **Go to Railway Dashboard:**
   - Open: https://railway.app
   - Navigate to project: `recall-v2-demo`
   - Click on service: `v2-demo-worker`

2. **Update Start Command:**
   - Go to **Settings** → **Deploy**
   - Find **"Custom Start Command"** field
   - **Current**: `npm start` ❌
   - **Change to**: `npm run start:worker` ✅
   - Click **Save** (this triggers a new deployment)

3. **Verify:**
   - Wait for deployment to complete (~1-2 minutes)
   - Check logs: `railway logs --service v2-demo-worker --tail 50`
   - Should see: `node worker/index.js` (NOT `node index.js`)
   - Should NOT see: "Server ready at http://0.0.0.0:3003"

## Why Dashboard Override?

Railway's config hierarchy:
1. **Dashboard override** (highest priority) ← Use this for worker
2. `railway.toml` in repo (shared by all services)
3. Dockerfile CMD/ENTRYPOINT (fallback)

Since both services share the same `railway.toml`, the worker needs a dashboard override.

## After Fixing

Once the start command is correct:
- ✅ Worker will process background jobs
- ✅ Webhooks will be processed
- ✅ Calendar status will update: "connecting" → "connected"
- ✅ Email addresses will populate

## Test Command

After updating, verify with:
```bash
railway logs --service v2-demo-worker --tail 50
```

Look for job processing messages, not web server startup messages.



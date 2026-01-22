# Fix Worker Service Start Command

## Problem Found

The worker service is running the **wrong command**:
- **Current**: `npm start` (runs main app)
- **Should be**: `npm run start:worker` (runs worker)

This means the worker is running the web server instead of processing background jobs!

## Solution: Update Start Command

### Via Railway Dashboard (Required)

Railway CLI doesn't support setting start commands directly. You must use the dashboard:

1. **Go to Railway Dashboard:**
   - Open: https://railway.app
   - Navigate to project: `recall-recall`
   - Click on service: `recall-worker`

2. **Update Start Command:**
   - Go to **Settings** → **Deploy**
   - Find **"Custom Start Command"** field
   - **Current value**: `npm start` ❌
   - **Change to**: `npm run start:worker` ✅
   - Click **Save** (this will trigger a new deployment)

3. **Verify:**
   - Wait for deployment to complete
   - Check logs: `railway logs --service recall-worker --tail 50`
   - You should see: `node worker/index.js` (not `node index.js`)
   - You should NOT see: "Server ready at http://0.0.0.0:3003"

## Expected Worker Logs (After Fix)

Once fixed, worker logs should show:
```
INFO: Database connection established.
INFO: Database migrations synced.
INFO: Recall service initialized
[Job processing messages when webhooks arrive]
```

**NOT:**
```
Server ready at http://0.0.0.0:3003  ❌ (This is the main app!)
```

## After Fixing

Once the worker is running correctly:
1. ✅ Webhooks will be processed
2. ✅ Calendar status will update: "connecting" → "connected"
3. ✅ Email will populate (no longer "null")
4. ✅ Background jobs will process

## Quick Test

After updating the start command, test with:

```bash
railway logs --service recall-worker --tail 20
```

Look for job processing messages when webhooks arrive.




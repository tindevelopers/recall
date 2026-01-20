# Fix Worker Service Deployment Issue

## Problem

The worker service won't start because it has **no source code connected**. Railway needs to know where to get the code from.

## Solution: Link Worker Service to GitHub Repository

The worker service needs to be connected to the same GitHub repository as your main service.

### Option 1: Via Railway Dashboard (Easiest)

1. **Go to Railway Dashboard:**
   - Open: https://railway.app
   - Navigate to project: `recall-v2-demo`
   - Click on service: `v2-demo-worker`

2. **Connect to GitHub:**
   - Go to **Settings** → **Source**
   - Click **"Connect GitHub Repo"** (or similar)
   - Select the same repository as your main service
   - Railway will automatically detect the code

3. **Verify Configuration:**
   - **Root Directory**: Should be root (or `v2-demo` if needed)
   - **Start Command**: Should be `npm run start:worker` (already set)
   - Railway will automatically deploy after connecting the repo

### Option 2: Duplicate Main Service (Alternative)

If Option 1 doesn't work, you can duplicate the main service:

1. In Railway dashboard, go to your main service (`recall-v2-demo`)
2. Click the **"..."** menu → **"Duplicate"**
3. Rename the duplicate to `v2-demo-worker`
4. Change **Start Command** to: `npm run start:worker`
5. The duplicate will have the same GitHub repo connection

### After Connecting Source

Once the repository is connected:
- Railway will automatically build and deploy
- Check logs: `railway logs --service v2-demo-worker --tail 50`
- You should see: `INFO: Database connection established.`

## Verify It's Working

After deployment, check:

```bash
railway logs --service v2-demo-worker --tail 50
```

Expected output:
- ✅ `INFO: Database connection established.`
- ✅ `INFO: Database migrations synced.`
- ✅ Job processing messages (when webhooks arrive)

## Why This Happened

When you created the worker service with `railway add --service v2-demo-worker`, it created an "Empty Service" with no source code. Railway needs either:
- A GitHub repository connection, OR
- A Docker image

Since your main service uses GitHub, the worker should too.



# Worker Directory Configuration Check

## Issue
The worker service needs to ensure it's building from the correct directory structure. The code is in the `recall/` subdirectory, but Railway may build from the root.

## Solution Applied

### Updated `recall/Dockerfile.worker`
The Dockerfile now explicitly copies from the `recall/` subdirectory, matching the main service's Dockerfile pattern:

```dockerfile
# Copy package files from recall subdirectory (building from root)
COPY recall/package.json recall/package-lock.json ./

# Copy application code from recall subdirectory (building from root)
COPY recall/ .
```

This ensures the worker builds correctly when Railway builds from the root directory.

## Railway Configuration

### Option 1: Root Directory (Recommended)
- **Root Directory**: Leave as root (default)
- **Dockerfile Path**: Railway should use `recall/Dockerfile.worker`
- The updated Dockerfile handles copying from `recall/` subdirectory

### Option 2: Set Root Directory to `recall`
- **Root Directory**: Set to `recall` in Railway dashboard
- **Dockerfile Path**: `Dockerfile.worker` (relative to recall directory)
- In this case, you'd need a different Dockerfile that copies from `.` instead

## Verification Steps

1. **Check Railway Dashboard**:
   - Go to `recall-worker` service
   - Settings → Deploy
   - Verify **Root Directory** setting
   - Verify **Start Command**: `npm run start:worker`

2. **Check Build Logs**:
   ```bash
   railway logs --service recall-worker --tail 100
   ```
   Look for:
   - ✅ `=== Building WORKER service using Dockerfile.worker ===`
   - ✅ No errors about missing files
   - ✅ `INFO: Database connection established`

3. **Verify Worker Starts Correctly**:
   ```bash
   railway logs --service recall-worker --tail 50
   ```
   Should see:
   - ✅ `🚀 Starting recall worker...`
   - ✅ `✅ Database connected`
   - ✅ `✅ Recall service initialized`
   - ✅ `🎯 Worker is now listening for jobs...`

## Current Configuration

- **Main Service Dockerfile**: `recall/Dockerfile` (copies from `recall/`)
- **Worker Service Dockerfile**: `recall/Dockerfile.worker` (now copies from `recall/`)
- **Root railway.toml**: Uses `dockerfilePath = "recall/Dockerfile"` for main service

## Note on Worker Service Configuration

The worker service should:
1. Use the same GitHub repository as the main service
2. Build from root directory (default)
3. Use `recall/Dockerfile.worker` as the Dockerfile
4. Have start command: `npm run start:worker`

If Railway doesn't automatically detect `Dockerfile.worker`, you may need to:
- Set **Root Directory** to `recall` in Railway dashboard, OR
- Create a service-specific railway.toml configuration


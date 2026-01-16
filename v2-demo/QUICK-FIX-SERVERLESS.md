# Quick Fix: Disable Serverless for Worker

## The Problem

Transcription isn't working because the worker service is sleeping (serverless mode). When the worker sleeps, it can't:
- Schedule bots with transcription config before meetings
- Process transcript webhooks after meetings

## The Solution (2 Minutes)

### Step 1: Open Railway Dashboard
1. Go to [railway.app](https://railway.app)
2. Navigate to your project
3. Click on your **worker service** (usually named `v2-demo-worker` or similar)

### Step 2: Disable Sleep Mode
1. Click the **"Settings"** tab
2. Scroll to **"Compute"** or **"Sleep"** section
3. Find **"Sleep"** toggle or **"Serverless"** setting
4. **Turn it OFF** or change to **"Always On"**
5. Save changes

### Step 3: Verify
1. Check service status - should show **"Running"** (not "Sleeping")
2. Check logs - should see continuous activity
3. Test with a new meeting - transcription should work

## That's It!

The worker will now run continuously and transcription will work reliably.

## Cost Impact

- **Before**: ~$0-5/month (serverless, only pay when active)
- **After**: ~$5-20/month (always-on, pay for continuous running)
- **Worth it?** Yes - transcription reliability is critical

## Need More Details?

See `RAILWAY-SERVERLESS-CONFIG.md` for:
- Detailed explanation
- Alternative wake-up mechanisms
- Troubleshooting guide

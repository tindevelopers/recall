# Railway Serverless Configuration Guide

## Overview

Railway supports two compute modes:
1. **Serverless** (default) - Services sleep after ~10 minutes of inactivity, wake on demand
2. **Always-On** - Services run continuously, never sleep

For transcription to work reliably, the worker **MUST** be available when:
- Calendar events are created/updated (to schedule bots with transcription config)
- Webhooks arrive from Recall.ai (to process transcripts)

## ⚠️ Problem with Serverless for Workers

**Serverless mode causes issues:**
- ❌ Cold start delays (5-30 seconds) when worker wakes up
- ❌ Bot scheduling might miss meetings if worker is asleep
- ❌ Webhook processing delayed or lost if worker is sleeping
- ❌ Transcription config not sent if worker wakes too late

## ✅ Solution: Disable Serverless (Recommended)

**Always-on mode ensures:**
- ✅ Worker is always ready to process jobs
- ✅ No cold start delays
- ✅ Reliable bot scheduling before meetings
- ✅ Immediate webhook processing

### How to Disable Serverless in Railway

#### Option 1: Via Railway Dashboard (Easiest)

1. **Go to Railway Dashboard**
   - Navigate to your project
   - Click on your **worker service** (e.g., `recall-worker`)

2. **Open Service Settings**
   - Click **"Settings"** tab
   - Scroll to **"Compute"** section

3. **Change Compute Type**
   - Find **"Sleep"** or **"Serverless"** setting
   - Toggle **OFF** or set to **"Always On"**
   - Or change **"Compute Type"** from **"Serverless"** to **"Standard"**

4. **Save Changes**
   - Railway will restart the service
   - Service will now run continuously

#### Option 2: Via Railway CLI

```bash
# Link to your project
railway link

# Set service to always-on (disable sleeping)
railway variables set RAILWAY_SLEEP=false --service recall-worker

# Or use Railway's compute settings
railway service update --service recall-worker --sleep=false
```

#### Option 3: Via railway.toml

Add to your `railway.toml`:

```toml
[deploy]
# Disable sleeping for worker service
sleep = false

# Or specify per-service (if Railway supports it)
[services.worker]
sleep = false
```

**Note:** Railway's `railway.toml` may not support per-service sleep settings. Use the dashboard or CLI instead.

### Verify Always-On is Enabled

1. **Check Service Status**
   - In Railway dashboard, worker service should show **"Running"** continuously
   - Should not show **"Sleeping"** or **"Idle"** status

2. **Check Logs**
   ```bash
   railway logs --service recall-worker --tail 50
   ```
   - Should see continuous activity or heartbeat logs
   - No "waking up" or "cold start" messages

3. **Test Worker Availability**
   - Create a test calendar event
   - Check logs immediately - should process without delay
   - No cold start delay should be visible

## 🔄 Alternative: Wake-Up Mechanism (If You Must Use Serverless)

If you need serverless for cost reasons, you can implement a wake-up mechanism:

### How It Works

1. **Before Meeting Starts**: Ping worker endpoint to wake it up
2. **On Webhook**: Worker wakes automatically when webhook arrives
3. **Scheduled Wake**: Use cron job to wake worker periodically

### Implementation

#### 1. Add Wake-Up Endpoint to Worker

Create `recall/routes/wake.js`:

```javascript
export default async (req, res) => {
  console.log('[WAKE] Worker woken up by wake-up request');
  res.json({ 
    status: 'awake', 
    timestamp: new Date().toISOString(),
    message: 'Worker is ready to process jobs'
  });
};
```

#### 2. Wake Worker Before Meetings

Modify `recall/worker/processors/calendar-event-update-bot-schedule.js`:

```javascript
// At the start of the processor
async function ensureWorkerAwake() {
  const workerUrl = process.env.WORKER_WAKE_URL || process.env.PUBLIC_URL + '/wake';
  try {
    await fetch(workerUrl, { method: 'GET' });
    console.log('[WAKE] Worker wake-up request sent');
  } catch (err) {
    console.warn('[WAKE] Failed to wake worker:', err.message);
  }
}

export default async (job) => {
  // Wake worker before processing
  await ensureWorkerAwake();
  
  // ... rest of processor code
};
```

#### 3. Wake Worker on Webhook

Modify `recall/routes/webhooks/recall-calendar-updates.js`:

```javascript
async function wakeWorker() {
  const workerUrl = process.env.WORKER_WAKE_URL || process.env.PUBLIC_URL + '/wake';
  try {
    await fetch(workerUrl, { method: 'GET' });
  } catch (err) {
    console.warn('[WAKE] Failed to wake worker:', err.message);
  }
}

export default async (req, res) => {
  // Wake worker before queuing jobs
  await wakeWorker();
  
  // ... rest of webhook handler
};
```

#### 4. Scheduled Wake-Up (Optional)

Use Railway's cron jobs or external cron service to ping worker every 5-10 minutes:

```bash
# Add to Railway environment variables
CRON_WAKE_URL=https://your-worker.up.railway.app/wake

# Use external cron service (e.g., cron-job.org) to ping this URL every 5 minutes
```

### Limitations of Wake-Up Approach

- ⚠️ Still has cold start delay (5-30 seconds)
- ⚠️ Adds complexity and failure points
- ⚠️ May miss time-sensitive jobs if wake-up fails
- ⚠️ Not recommended for production transcription

## 💰 Cost Comparison

### Always-On Worker
- **Cost**: ~$5-20/month (depending on Railway pricing)
- **Reliability**: ✅ 100% uptime, no delays
- **Best for**: Production, critical transcription

### Serverless Worker
- **Cost**: ~$0-5/month (only pay when active)
- **Reliability**: ⚠️ Cold starts, potential delays
- **Best for**: Development, low-traffic testing

## 📋 Recommended Configuration

**For Production:**
- ✅ **Main App**: Serverless (OK - handles HTTP requests)
- ✅ **Worker**: Always-On (Required - processes background jobs)

**For Development:**
- ✅ Both can be serverless if you're OK with cold starts
- ✅ Or use local worker: `npm run dev:worker`

## 🔍 Troubleshooting

### Worker Still Sleeping

1. **Check Railway Dashboard**
   - Verify "Sleep" is disabled in service settings
   - Check service status shows "Running"

2. **Check Environment Variables**
   ```bash
   railway variables --service recall-worker
   ```
   - Look for `RAILWAY_SLEEP=false` or similar

3. **Restart Service**
   - In Railway dashboard, click "Restart" on worker service
   - Verify it stays running

### Worker Wakes But Too Late

- **Symptom**: Bot scheduled but transcription config missing
- **Cause**: Worker woke up after bot was already scheduled
- **Fix**: Use always-on mode instead of serverless

### High Costs with Always-On

- **Option 1**: Use smaller instance size (if Railway supports it)
- **Option 2**: Implement hybrid: always-on during business hours, serverless off-hours
- **Option 3**: Use external worker (e.g., Render, Fly.io) with better pricing

## 🎯 Final Recommendation

**For transcription to work reliably, use Always-On mode for the worker service.**

The small cost increase (~$5-20/month) is worth the reliability and eliminates transcription failures due to cold starts.

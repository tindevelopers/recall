# Worker Environment Variables Checklist

This document lists all environment variables required for the worker service to function correctly.

## Required Environment Variables

### Core Infrastructure

1. **`DATABASE_URL`** (REQUIRED)
   - PostgreSQL connection string
   - Format: `postgresql://user:password@host:port/database`
   - Auto-set by Railway when PostgreSQL service is added
   - Used by: `db.js` for database connections
   - **Critical**: Worker will fail to start without this

2. **`REDIS_URL`** (REQUIRED)
   - Redis connection string for background job queue
   - Format: `redis://user:password@host:port` or `redis://host:port`
   - Auto-set by Railway when Redis service is added
   - Used by: `queue.js` for Bull queue
   - **Critical**: Worker will fail to process jobs without this

3. **`NODE_ENV`** (REQUIRED)
   - Environment mode: `production` or `development`
   - Should be `production` in Railway
   - Used by: Database SSL configuration, logging
   - Default: `production` (set in `railway-worker.toml`)

### Recall.ai API

4. **`RECALL_API_KEY`** (REQUIRED)
   - Your Recall.ai API key/token
   - Get from: Recall.ai dashboard
   - Used by: `services/recall/api-client.js`
   - **Critical**: Bot scheduling and calendar sync will fail without this

5. **`RECALL_API_HOST`** (REQUIRED)
   - Base URL for Recall.ai API
   - Value: `https://api.recall.ai` (base URL only, no `/api/v1` or `/api/v2`)
   - Used by: `services/recall/api-client.js`
   - **Critical**: API calls will fail without this

### Public URL (for Webhooks)

6. **`PUBLIC_URL`** (REQUIRED)
   - Public URL of your application (for webhook callbacks)
   - Format: `https://your-app.up.railway.app` or custom domain
   - Used by: `worker/processors/calendar-event-update-bot-schedule.js` for bot webhook URLs
   - Fallbacks: `RAILWAY_PUBLIC_DOMAIN` or `RAILWAY_STATIC_URL` (if `PUBLIC_URL` not set)
   - **Critical**: Bot webhooks won't work correctly without this

### Optional Environment Variables

7. **`OPENAI_API_KEY`** (OPTIONAL but recommended)
   - OpenAI API key for fallback summarization
   - Used when Recall.ai Notepad API is unavailable
   - Used by: `services/openai/index.js`, `services/notepad/index.js`
   - **Note**: Worker will log warnings but continue if not set

8. **`OPENAI_MODEL_SUMMARY`** (OPTIONAL)
   - OpenAI model for meeting summaries
   - Default: `gpt-4o-mini`
   - Used by: `services/openai/index.js`

9. **`OPENAI_MODEL_EMBEDDINGS`** (OPTIONAL)
   - OpenAI model for text embeddings
   - Default: `text-embedding-3-small`
   - Used by: `services/openai/index.js`

10. **`PORT`** (OPTIONAL)
    - Port number (worker doesn't serve HTTP, but may be used for logging)
    - Default: `3003` (set in `railway-worker.toml`)
    - Used by: Logging/telemetry

### Railway-Specific Variables (Auto-set)

These are automatically set by Railway and can be used as fallbacks:

- **`RAILWAY_PUBLIC_DOMAIN`** - Auto-set by Railway (used as fallback for `PUBLIC_URL`)
- **`RAILWAY_STATIC_URL`** - Auto-set by Railway (used as fallback for `PUBLIC_URL`)

## Verification

### Check Environment Variables in Railway

1. **Link to worker service:**
   ```bash
   railway service <worker-service-name>
   ```

2. **List all variables:**
   ```bash
   railway variables
   ```

3. **Check specific variable:**
   ```bash
   railway variables | grep DATABASE_URL
   railway variables | grep REDIS_URL
   railway variables | grep RECALL_API_KEY
   ```

### Check Worker Logs

The worker logs show which environment variables are configured at startup:

```bash
railway logs --service <worker-service-name> --tail 50
```

Look for these startup messages:
- ✅ `💾 Database: PostgreSQL (configured)` - DATABASE_URL is set
- ✅ `🔗 Redis URL: redis://...` - REDIS_URL is set
- ✅ `📋 Environment: production` - NODE_ENV is set
- ✅ `✅ Recall service initialized` - RECALL_API_KEY and RECALL_API_HOST are set

### Common Issues

**Worker fails to start:**
- Check if `DATABASE_URL` is set
- Check if `REDIS_URL` is set
- Check worker logs for specific error

**Bot scheduling fails:**
- Verify `RECALL_API_KEY` is set correctly
- Verify `RECALL_API_HOST` is `https://api.recall.ai` (not `https://api.recall.ai/api/v1`)
- Verify `PUBLIC_URL` is set correctly

**Webhooks not working:**
- Verify `PUBLIC_URL` is set to your Railway domain
- Check if `RAILWAY_PUBLIC_DOMAIN` or `RAILWAY_STATIC_URL` are available as fallbacks

**OpenAI features not working:**
- Verify `OPENAI_API_KEY` is set (optional, but needed for fallback summarization)

## Quick Setup Script

Run this to check all required variables:

```bash
./check-worker-env.sh
```

Or manually check each variable:

```bash
railway service <worker-service-name>
railway variables | grep -E "(DATABASE_URL|REDIS_URL|RECALL_API_KEY|RECALL_API_HOST|PUBLIC_URL|NODE_ENV)"
```

## Setting Missing Variables

```bash
# Link to worker service first
railway service <worker-service-name>

# Set required variables
railway variables set RECALL_API_KEY=your-key-here
railway variables set RECALL_API_HOST=https://api.recall.ai
railway variables set PUBLIC_URL=https://your-app.up.railway.app
railway variables set NODE_ENV=production

# Optional: Set OpenAI key for fallback summarization
railway variables set OPENAI_API_KEY=your-openai-key-here
```

## Notes

- **DATABASE_URL** and **REDIS_URL** are typically auto-set by Railway when you add PostgreSQL and Redis services
- **PUBLIC_URL** must be set manually - get it from Railway dashboard or `railway domain` command
- All environment variables should be set for **both** the main app service and worker service
- Worker service uses the same environment variables as the main app service



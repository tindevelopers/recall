# V2 Demo Deployment Guide

This guide covers deploying the recall application to Railway (or other platforms).

## Railway Deployment

Railway is configured via `railway.toml` in the root directory. V2-demo requires **3 services**:

1. **Main Application** - Express server
2. **Worker** - Background job processor (Bull queue)
3. **Redis** - Required for Bull queue

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app)
2. Create a new project
3. Connect your GitHub repository

### Step 2: Add Database Services

**Add PostgreSQL:**
1. In Railway dashboard, click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
2. Railway will automatically create a `DATABASE_URL` environment variable
3. The app will automatically use PostgreSQL when `DATABASE_URL` is present

**Add Redis:**
1. In Railway dashboard, click **"+ New"** → **"Database"** → **"Add Redis"**
2. Railway will automatically create a `REDIS_URL` environment variable
3. Note the Redis service name (e.g., `redis`)

### Step 3: Deploy Main Application Service

1. Click **"+ New"** → **"GitHub Repo"** → Select your repo
2. Railway will detect `railway.toml` automatically
3. Configure the service:
   - **Root Directory**: Leave as root (Railway will use dockerfilePath)
   - **Dockerfile Path**: `recall/Dockerfile` (from railway.toml)
   - **Start Command**: `npm start` (from railway.toml)

### Step 4: Add Worker Service

The worker needs to run separately. You have two options:

#### Option A: Duplicate Service (Recommended)

1. In Railway, duplicate the main application service
2. Rename it to "recall-worker"
3. Change the **Start Command** to: `npm run start:worker` (or `npm run dev:worker` for dev)
4. Use the same environment variables as the main service
5. **⚠️ IMPORTANT: Disable Serverless/Sleep Mode**
   - Go to worker service **Settings** → **Compute**
   - Disable **"Sleep"** or set to **"Always On"**
   - This ensures the worker is always ready to process jobs
   - See `RAILWAY-SERVERLESS-CONFIG.md` for details

#### Option B: Use Railway Scripts

Create a Procfile or use Railway's start command override.

**Note:** The worker service **MUST** be always-on (not serverless) for transcription to work reliably. Serverless mode causes cold start delays that can prevent bot scheduling and transcription.

### Step 5: Configure Environment Variables

Set these environment variables for **both** main app and worker services:

#### Required Variables:
```
SECRET=<generate-a-random-secret-key>
RECALL_API_KEY=<your-recall-api-key>
RECALL_API_HOST=https://api.recall.ai
PUBLIC_URL=https://your-app-name.up.railway.app
DATABASE_URL=<automatically-set-by-railway-postgresql>
REDIS_URL=<automatically-set-by-railway-redis-service>
PORT=3003
NODE_ENV=production
```

#### Optional OAuth Variables:
```
GOOGLE_CALENDAR_OAUTH_CLIENT_ID=<your-google-client-id>
GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=<your-google-client-secret>
MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID=<your-microsoft-client-id>
MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET=<your-microsoft-client-secret>
```

**Important Notes:**
- `SECRET`: Generate with `openssl rand -hex 32`
- `PUBLIC_URL`: Use Railway's generated domain or your custom domain
- `DATABASE_URL`: Railway automatically provides this when you add PostgreSQL service
- `REDIS_URL`: Railway automatically provides this when you add Redis service
- For OAuth: Update redirect URIs in Google/Microsoft consoles to match `PUBLIC_URL`
- **Database:** The app automatically uses PostgreSQL when `DATABASE_URL` is present, or SQLite for local development

### Step 6: Connect Services

1. Make sure the main app and worker services can access Redis
2. Railway automatically connects services in the same project
3. Use the Redis service's connection string for `REDIS_URL`

### Step 7: Deploy

1. Railway will automatically deploy on git push
2. Or click **"Deploy"** in the Railway dashboard
3. Check logs for both services to ensure they start correctly

## Docker Deployment (Alternative)

If deploying with Docker Compose:

```bash
cd recall
docker compose up -d
```

Make sure to set environment variables in `.env` file or via `docker compose` environment section.

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SECRET` | Yes | JWT signing secret | `openssl rand -hex 32` |
| `RECALL_API_KEY` | Yes | Your Recall API key | `token_...` |
| `RECALL_API_HOST` | Yes | Recall API base URL (without `/api/v1` or `/api/v2`). Use region-specific endpoint if your API key is region-specific: `https://us-east-1.recall.ai`, `https://us-west-2.recall.ai`, `https://eu-central-1.recall.ai`, or `https://ap-northeast-1.recall.ai` | `https://api.recall.ai` (or region-specific) |
| `PUBLIC_URL` | Yes | Public URL for OAuth | `https://your-app.up.railway.app` |
| `DATABASE_URL` | Yes* | PostgreSQL connection string | `postgresql://...` (auto-set by Railway PostgreSQL) |
| `REDIS_URL` | Yes | Redis connection string | `redis://...` (auto-set by Railway) |
| `PORT` | No | Server port | `3003` |
| `NODE_ENV` | No | Environment | `production` |

\* Required for production. If not set, app uses SQLite (for local development only)
| `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` | Optional | Google OAuth client ID | - |
| `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` | Optional | Google OAuth secret | - |
| `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` | Optional | Microsoft OAuth client ID | - |
| `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` | Optional | Microsoft OAuth secret | - |

## Troubleshooting

### Worker Not Running
- Make sure you have a separate worker service in Railway
- Check worker logs: `railway logs --service worker-service-name`
- Verify `REDIS_URL` is set correctly

### Redis Connection Errors
- Ensure Redis service is running
- Check `REDIS_URL` environment variable
- Verify services are in the same Railway project

### Database Issues

**Problem: Database Resets on Redeploy**

By default, the app uses SQLite stored as a file (`db.sqlite`) in the container filesystem. On Railway, containers are rebuilt on each deploy, so the database file is lost.

**Solution: Use PostgreSQL (Recommended)**

PostgreSQL is now the default for production. The app automatically detects and uses PostgreSQL when `DATABASE_URL` is present:

1. In Railway dashboard, click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
2. Railway automatically creates `DATABASE_URL` environment variable
3. The app will automatically use PostgreSQL - no code changes needed
4. Migrations run automatically on startup
5. Redeploy your service

**Why PostgreSQL is Better:**
- ✅ Managed service (automatic backups, scaling)
- ✅ Better for concurrent access
- ✅ Production-ready
- ✅ Persistent across redeploys automatically
- ✅ No volume management needed

**For Local Development:**
- The app automatically uses SQLite when `DATABASE_URL` is not set
- No PostgreSQL needed locally - just use `npm run dev`

### Port Issues
- Railway automatically assigns ports
- Use `PORT` environment variable if needed
- Check Railway service settings

### Recall API 404 Errors

**Error: `POST request failed with status 404`**
- **Problem:** The `RECALL_API_HOST` is incorrectly configured
- **Solution:**
  1. Check your `RECALL_API_HOST` environment variable in Railway
  2. It should be set to: `https://api.recall.ai` (base URL only)
  3. **Do NOT** include `/api/v1` or `/api/v2` in the host
  4. The code will append the correct API path (`/api/v2/calendars/`) automatically
  5. After updating, redeploy your service

**Common Mistakes:**
- ❌ `RECALL_API_HOST=https://api.recall.ai/api/v1` (wrong - includes version)
- ✅ `RECALL_API_HOST=https://api.recall.ai` (correct - base URL only)

### OAuth Redirect URI Errors

**Error: `AADSTS50011` (Azure AD)**
- **Problem:** The redirect URI doesn't match what's configured in Azure AD
- **Solution:**
  1. Go to [Azure Portal](https://portal.azure.com/) → Azure Active Directory → App registrations
  2. Find your application (Application ID: `c4ab4004-1aa3-4b65-bb4a-2d7c6ac39176`)
  3. Click "Authentication" → "Add a platform" → "Web"
  4. Add redirect URI: `https://your-app.up.railway.app/oauth-callback/microsoft-outlook`
  5. Ensure it matches exactly (no trailing slash, correct protocol)
  6. Wait a few minutes for changes to propagate

**Error: `redirect_uri_mismatch` (Google)**
- **Problem:** The redirect URI doesn't match what's configured in Google Cloud Console
- **Solution:**
  1. Go to [Google Cloud Console](https://console.cloud.google.com/)
  2. Navigate to APIs & Services → Credentials
  3. Click on your OAuth 2.0 Client ID
  4. Add redirect URI: `https://your-app.up.railway.app/oauth-callback/google-calendar`
  5. Save changes

## Railway CLI (Optional)

You can also deploy using Railway CLI:

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link project
railway link

# Set environment variables
railway variables set SECRET=$(openssl rand -hex 32)
railway variables set RECALL_API_KEY=your-key
railway variables set PUBLIC_URL=https://your-app.up.railway.app

# Deploy
railway up
```

## Health Check

The application has a health check endpoint at `/` (configured in railway.toml).

Check deployment status:
```bash
curl https://your-app.up.railway.app/
```

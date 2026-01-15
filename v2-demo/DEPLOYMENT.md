# V2 Demo Deployment Guide

This guide covers deploying the v2-demo application to Railway (or other platforms).

## Railway Deployment

Railway is configured via `railway.toml` in the root directory. V2-demo requires **3 services**:

1. **Main Application** - Express server
2. **Worker** - Background job processor (Bull queue)
3. **Redis** - Required for Bull queue

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app)
2. Create a new project
3. Connect your GitHub repository

### Step 2: Add Redis Service

1. In Railway dashboard, click **"+ New"** → **"Database"** → **"Add Redis"**
2. Railway will automatically create a `REDIS_URL` environment variable
3. Note the Redis service name (e.g., `redis`)

### Step 3: Deploy Main Application Service

1. Click **"+ New"** → **"GitHub Repo"** → Select your repo
2. Railway will detect `railway.toml` automatically
3. Configure the service:
   - **Root Directory**: Leave as root (Railway will use dockerfilePath)
   - **Dockerfile Path**: `v2-demo/Dockerfile` (from railway.toml)
   - **Start Command**: `npm start` (from railway.toml)

### Step 4: Add Worker Service

The worker needs to run separately. You have two options:

#### Option A: Duplicate Service (Recommended)

1. In Railway, duplicate the main application service
2. Rename it to "v2-demo-worker"
3. Change the **Start Command** to: `npm run dev:worker`
4. Use the same environment variables as the main service

#### Option B: Use Railway Scripts

Create a Procfile or use Railway's start command override.

### Step 5: Configure Environment Variables

Set these environment variables for **both** main app and worker services:

#### Required Variables:
```
SECRET=<generate-a-random-secret-key>
RECALL_API_KEY=<your-recall-api-key>
RECALL_API_HOST=https://api.recall.ai/api/v1
PUBLIC_URL=https://your-app-name.up.railway.app
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
- `REDIS_URL`: Railway automatically provides this when you add Redis service
- For OAuth: Update redirect URIs in Google/Microsoft consoles to match `PUBLIC_URL`

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
cd v2-demo
docker compose up -d
```

Make sure to set environment variables in `.env` file or via `docker compose` environment section.

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SECRET` | Yes | JWT signing secret | `openssl rand -hex 32` |
| `RECALL_API_KEY` | Yes | Your Recall API key | `token_...` |
| `RECALL_API_HOST` | Yes | Recall API base URL | `https://api.recall.ai/api/v1` |
| `PUBLIC_URL` | Yes | Public URL for OAuth | `https://your-app.up.railway.app` |
| `REDIS_URL` | Yes | Redis connection string | `redis://...` (auto-set by Railway) |
| `PORT` | No | Server port | `3003` |
| `NODE_ENV` | No | Environment | `production` |
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
- SQLite database is created automatically
- For persistent storage, consider using Railway's volume or PostgreSQL

### Port Issues
- Railway automatically assigns ports
- Use `PORT` environment variable if needed
- Check Railway service settings

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

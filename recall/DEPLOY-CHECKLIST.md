# V2 Demo Deployment Checklist

Quick checklist for deploying recall to Railway.

## Pre-Deployment

- [ ] Generate `SECRET` key: `openssl rand -hex 32`
- [ ] Get `RECALL_API_KEY` from Recall.ai dashboard
- [ ] Set up OAuth clients (Google/Microsoft) if needed
- [ ] Note OAuth redirect URIs (will need Railway URL)

## Railway Setup

### 1. Create Project
- [ ] Go to Railway.app and create new project
- [ ] Connect GitHub repository

### 2. Add Redis Service
- [ ] Click "+ New" → "Database" → "Add Redis"
- [ ] Note the `REDIS_URL` (auto-generated)

### 2a. Add PostgreSQL Database (Recommended)

- [ ] Click "+ New" → "Database" → "Add PostgreSQL"
- [ ] Railway automatically creates `DATABASE_URL` environment variable
- [ ] The app will automatically use PostgreSQL when `DATABASE_URL` is present
- [ ] No additional configuration needed - migrations run automatically on startup

**Note:** For local development, the app will use SQLite (no PostgreSQL needed locally)

### 3. Deploy Main Application
- [ ] Click "+ New" → "GitHub Repo" → Select repo
- [ ] Railway detects `railway.toml` automatically
- [ ] Set Root Directory: Leave as root (uses `dockerfilePath: recall/Dockerfile`)
- [ ] Verify Start Command: `npm start`

### 4. Deploy Worker Service
- [ ] Duplicate the main application service
- [ ] Rename to "recall-worker"
- [ ] Change Start Command to: `npm run start:worker`
- [ ] Use same environment variables as main service

### 5. Set Environment Variables

Set for **BOTH** main app and worker:

**Required:**
- [ ] `SECRET` = `<generated-secret>`
- [ ] `RECALL_API_KEY` = `<your-api-key>`
- [ ] `RECALL_API_HOST` = `https://api.recall.ai` (base URL only, without `/api/v1` or `/api/v2`)
- [ ] `PUBLIC_URL` = `https://your-app-name.up.railway.app` (or custom domain)
- [ ] `REDIS_URL` = `<auto-set-by-railway-redis>`
- [ ] `PORT` = `3003`
- [ ] `NODE_ENV` = `production`

**Database (PostgreSQL recommended):**
- [ ] `DATABASE_URL` = `<auto-set-by-railway-postgresql>` (automatically configured when you add PostgreSQL service)
- [ ] No need to set `DATABASE_PATH` - PostgreSQL handles persistence automatically

**Optional (OAuth):**
- [ ] `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` = `<google-client-id>`
- [ ] `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` = `<google-secret>`
- [ ] `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` = `<microsoft-client-id>`
- [ ] `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` = `<microsoft-secret>`

### 6. Update OAuth Redirect URIs

**Google Cloud Console:**
- [ ] Go to [Google Cloud Console](https://console.cloud.google.com/)
- [ ] Navigate to APIs & Services → Credentials
- [ ] Click on your OAuth 2.0 Client ID
- [ ] Under "Authorized redirect URIs", click "Add URI"
- [ ] Add: `https://your-app.up.railway.app/oauth-callback/google-calendar`
- [ ] Click "Save"

**Azure Portal (Microsoft Outlook):**
- [ ] Go to [Azure Portal](https://portal.azure.com/)
- [ ] Navigate to Azure Active Directory → App registrations
- [ ] Find and click on your application (or search by Application ID: `c4ab4004-1aa3-4b65-bb4a-2d7c6ac39176`)
- [ ] Click on "Authentication" in the left sidebar
- [ ] Under "Platform configurations", click "Add a platform" → "Web"
- [ ] Under "Redirect URIs", click "Add URI"
- [ ] Add: `https://your-app.up.railway.app/oauth-callback/microsoft-outlook`
- [ ] Click "Configure"
- [ ] **Important:** Make sure the redirect URI matches exactly (including `https://` and no trailing slash)

**Common Issues:**
- If you get `AADSTS50011` error, the redirect URI is not registered in Azure AD
- Ensure the URI matches exactly (case-sensitive, no trailing slashes)
- After adding, wait a few minutes for changes to propagate

### 7. Deploy

- [ ] Push to GitHub (auto-deploys) OR click "Deploy" in Railway
- [ ] Check main app logs: Should see "✅ Started demo app on port 3003"
- [ ] Check worker logs: Should see job processing messages
- [ ] Test health endpoint: `curl https://your-app.up.railway.app/`

## Post-Deployment Verification

- [ ] Main app responds at root URL `/`
- [ ] Worker is processing jobs (check logs)
- [ ] Redis connection working (no errors in logs)
- [ ] Database migrations ran successfully
- [ ] OAuth callbacks work (if configured)

## Troubleshooting

**Worker not running:**
- Check if worker service exists and is running
- Verify `npm run start:worker` command
- Check worker logs for errors

**Redis connection errors:**
- Verify `REDIS_URL` is set correctly
- Ensure Redis service is running
- Check services are in same Railway project

**Port issues:**
- Railway auto-assigns ports
- Use `PORT` env var if needed
- Check service settings

## Quick Deploy Commands (Railway CLI)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link project
railway link

# Set variables
railway variables set SECRET=$(openssl rand -hex 32)
railway variables set RECALL_API_KEY=your-key
railway variables set PUBLIC_URL=https://your-app.up.railway.app

# Deploy
railway up
```

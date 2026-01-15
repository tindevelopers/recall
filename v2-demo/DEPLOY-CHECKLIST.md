# V2 Demo Deployment Checklist

Quick checklist for deploying v2-demo to Railway.

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

### 3. Deploy Main Application
- [ ] Click "+ New" → "GitHub Repo" → Select repo
- [ ] Railway detects `railway.toml` automatically
- [ ] Set Root Directory: Leave as root (uses `dockerfilePath: v2-demo/Dockerfile`)
- [ ] Verify Start Command: `npm start`

### 4. Deploy Worker Service
- [ ] Duplicate the main application service
- [ ] Rename to "v2-demo-worker"
- [ ] Change Start Command to: `npm run start:worker`
- [ ] Use same environment variables as main service

### 5. Set Environment Variables

Set for **BOTH** main app and worker:

**Required:**
- [ ] `SECRET` = `<generated-secret>`
- [ ] `RECALL_API_KEY` = `<your-api-key>`
- [ ] `RECALL_API_HOST` = `https://api.recall.ai/api/v1`
- [ ] `PUBLIC_URL` = `https://your-app-name.up.railway.app` (or custom domain)
- [ ] `REDIS_URL` = `<auto-set-by-railway-redis>`
- [ ] `PORT` = `3003`
- [ ] `NODE_ENV` = `production`

**Optional (OAuth):**
- [ ] `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` = `<google-client-id>`
- [ ] `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` = `<google-secret>`
- [ ] `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` = `<microsoft-client-id>`
- [ ] `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` = `<microsoft-secret>`

### 6. Update OAuth Redirect URIs

- [ ] Google Cloud Console: Add `https://your-app.up.railway.app/oauth-callback/google-calendar`
- [ ] Azure Portal: Add `https://your-app.up.railway.app/oauth-callback/microsoft-outlook`

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

# Deploy to Railway - Quick Guide

You're logged in to Railway CLI! Follow these steps to deploy:

## Step 1: Link Your Project (Run this in your terminal)

Since Railway CLI requires interactive selection, run this command in your terminal:

```bash
cd /Users/gene/Projects/recall
railway link
```

Then select your workspace and project from the list.

## Step 2: After Linking, Run Deployment

Once linked, you can either:

**Option A: Use the deployment script**
```bash
./deploy-to-railway.sh
```

**Option B: Deploy manually**
```bash
railway up
```

## Step 3: Verify Environment Variables

After linking, check your environment variables:

```bash
railway variables
```

Make sure these are set:
- `SECRET` - Generate with: `openssl rand -hex 32`
- `RECALL_API_KEY` - Your Recall API key
- `RECALL_API_HOST` - Should be `https://api.recall.ai`
- `DATABASE_URL` - Auto-set by Railway PostgreSQL (if PostgreSQL service exists)
- `REDIS_URL` - Auto-set by Railway Redis
- `PUBLIC_URL` - Your Railway domain
- `PORT` - `3003`
- `NODE_ENV` - `production`

## Step 4: Set Missing Variables (if needed)

```bash
# Generate SECRET if not set
railway variables set SECRET=$(openssl rand -hex 32)

# Set RECALL_API_KEY (replace with your actual key)
railway variables set RECALL_API_KEY=your-actual-key-here

# Set RECALL_API_HOST
railway variables set RECALL_API_HOST=https://api.recall.ai

# Set PORT and NODE_ENV
railway variables set PORT=3003
railway variables set NODE_ENV=production

# Get and set PUBLIC_URL after deployment
railway domain
railway variables set PUBLIC_URL=$(railway domain)
```

## Step 5: Verify Services in Railway Dashboard

Make sure you have:
1. ✅ PostgreSQL service (for database persistence)
2. ✅ Redis service (for background jobs)
3. ✅ Main application service
4. ✅ Worker service (with start command: `npm run start:worker`)

## Step 6: Check Deployment Status

```bash
# View logs
railway logs

# Check status
railway status

# Get domain
railway domain
```

## Troubleshooting

**If linking fails:**
- Make sure you're logged in: `railway whoami`
- Try creating a new project: `railway init`

**If deployment fails:**
- Check logs: `railway logs`
- Verify all environment variables are set: `railway variables`
- Ensure PostgreSQL and Redis services exist in Railway dashboard




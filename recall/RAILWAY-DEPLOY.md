# Railway CLI Deployment - Step by Step

Follow these steps to deploy recall using Railway CLI.

## Step 1: Login to Railway

```bash
cd /Users/foo/projects/Recall.ai
railway login
```

This will open your browser to authenticate.

## Step 2: Create/Link Project

### Option A: Create New Project
```bash
railway init
# Follow prompts to create a new project
```

### Option B: Link to Existing Project
```bash
railway link
# Select your existing project
```

## Step 3: Add Redis Service (via Dashboard)

Railway CLI doesn't support creating services directly. You need to:

1. Go to https://railway.app
2. Open your project
3. Click **"+ New"** → **"Database"** → **"Add Redis"**
4. Railway will automatically create `REDIS_URL` environment variable

## Step 4: Set Environment Variables

Run these commands to set required environment variables:

```bash
# Generate and set SECRET
railway variables set SECRET=$(openssl rand -hex 32)

# Set Recall API credentials (replace with your actual values)
railway variables set RECALL_API_KEY=your-recall-api-key-here
railway variables set RECALL_API_HOST=https://api.recall.ai

# Set PUBLIC_URL (update after deployment with your actual Railway URL)
railway variables set PUBLIC_URL=https://your-app-name.up.railway.app

# Set other required vars
railway variables set PORT=3003
railway variables set NODE_ENV=production
```

**Note:** After deployment, Railway will give you a URL. Update `PUBLIC_URL` with that URL.

## Step 5: Deploy Main Application

```bash
railway up
```

This will:
- Build the Docker image using `recall/Dockerfile`
- Deploy to Railway
- Start the application

## Step 6: Get Your Deployment URL

```bash
railway domain
```

Or check Railway dashboard. Update `PUBLIC_URL` with this URL:

```bash
railway variables set PUBLIC_URL=https://your-actual-url.up.railway.app
```

## Step 7: Create Worker Service (via Dashboard)

The worker needs to run separately:

1. Go to Railway dashboard
2. In your project, click **"+ New"** → **"Empty Service"**
3. Or duplicate the main service
4. Set the **Root Directory** to: `recall` (or leave root if using railway.toml)
5. Set **Start Command** to: `npm run start:worker`
6. Make sure it has the same environment variables as the main service

## Step 8: Verify Deployment

Check logs:
```bash
# Main app logs
railway logs

# Worker logs (if you have service name)
railway logs --service worker-service-name
```

Test the deployment:
```bash
curl $(railway domain)
```

## Quick Reference Commands

```bash
# Check status
railway status

# View variables
railway variables

# View logs
railway logs

# Open dashboard
railway open

# Deploy
railway up

# Get domain
railway domain
```

## Troubleshooting

**Build fails:**
- Check `railway.toml` is in root directory
- Verify `dockerfilePath: recall/Dockerfile` is correct
- Check Dockerfile paths are correct

**App won't start:**
- Check logs: `railway logs`
- Verify all environment variables are set
- Ensure Redis service is running

**Worker not processing jobs:**
- Verify worker service exists
- Check worker logs
- Ensure `REDIS_URL` is set correctly

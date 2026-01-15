# Deploy V2 Demo - Commands to Run

You're logged in! Now run these commands in your terminal:

## Step 1: Link or Create Project

**Option A: Link to existing project**
```bash
cd /Users/foo/projects/Recall.ai
railway link
# Select your workspace and project
```

**Option B: Create new project**
```bash
cd /Users/foo/projects/Recall.ai
railway init
# Follow prompts to create new project
```

## Step 2: Set Environment Variables

After linking, run these commands (replace `your-recall-api-key-here` with your actual API key):

```bash
# Generate and set SECRET
railway variables set SECRET=$(openssl rand -hex 32)

# Set Recall API credentials
railway variables set RECALL_API_KEY=your-recall-api-key-here
railway variables set RECALL_API_HOST=https://api.recall.ai/api/v1

# Set other required vars
railway variables set PORT=3003
railway variables set NODE_ENV=production
```

## Step 3: Add Redis Service

Go to Railway dashboard:
1. Open https://railway.app
2. Select your project
3. Click **"+ New"** → **"Database"** → **"Add Redis"**
4. Railway will automatically set `REDIS_URL`

## Step 4: Deploy

```bash
railway up
```

## Step 5: Update PUBLIC_URL

After deployment completes:

```bash
# Get your Railway domain
railway domain

# Update PUBLIC_URL (replace with your actual domain from above)
railway variables set PUBLIC_URL=https://your-actual-domain.up.railway.app
```

## Step 6: Create Worker Service

In Railway dashboard:
1. Click **"+ New"** → **"Empty Service"** (or duplicate main service)
2. Set **Root Directory**: Leave as root (uses railway.toml)
3. Set **Start Command**: `npm run start:worker`
4. Make sure it has same environment variables as main service

## Verify Deployment

```bash
# Check status
railway status

# View logs
railway logs

# Test endpoint
curl $(railway domain)
```

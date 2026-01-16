# Fix Recall API Region Issue

## Problem

Your API token is region-specific, but `RECALL_API_HOST` is set to the generic endpoint (`https://api.recall.ai`). This causes authentication failures.

## Solution

You need to update `RECALL_API_HOST` to match the region of your API key.

### Step 1: Identify Your API Key's Region

Check your Recall.ai dashboard to see which region your API key belongs to. Common regions:
- **us-east-1**: `https://us-east-1.recall.ai`
- **us-west-2**: `https://us-west-2.recall.ai`
- **eu-central-1**: `https://eu-central-1.recall.ai`
- **ap-northeast-1**: `https://ap-northeast-1.recall.ai`

### Step 2: Update RECALL_API_HOST

Once you know your region, update the environment variable:

```bash
# For us-east-1
railway variables --set "RECALL_API_HOST=https://us-east-1.recall.ai" --service recall-v2-demo

# For us-west-2
railway variables --set "RECALL_API_HOST=https://us-west-2.recall.ai" --service recall-v2-demo

# For eu-central-1
railway variables --set "RECALL_API_HOST=https://eu-central-1.recall.ai" --service recall-v2-demo

# For ap-northeast-1
railway variables --set "RECALL_API_HOST=https://ap-northeast-1.recall.ai" --service recall-v2-demo
```

### Step 3: Redeploy

After updating, redeploy:

```bash
railway up
```

### Step 4: Verify

Check logs to confirm it's working:

```bash
railway logs --tail 50 | grep -i "recall\|api"
```

You should see successful API calls without authentication errors.

## Alternative: Get a New API Key

If you're unsure which region your key belongs to, you can:
1. Go to your Recall.ai dashboard
2. Generate a new API key for the default region
3. Update `RECALL_API_KEY` in Railway


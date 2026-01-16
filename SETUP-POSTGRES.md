# Set Up PostgreSQL Database on Railway

## Quick Setup (Interactive)

Since Railway CLI requires interactive input for adding databases, run this command in your terminal:

```bash
cd /Users/gene/Projects/recall
railway add --database postgres
```

When prompted:
1. Select **"Database"**
2. Select **"PostgreSQL"** (or just press Enter if it's the default)
3. Railway will create the PostgreSQL service and automatically set `DATABASE_URL`

## Verify Setup

After adding PostgreSQL, verify it's configured:

### 1. Check if DATABASE_URL is set

```bash
# Link to any service first
railway service <your-service-name>

# Check variables
railway variables | grep DATABASE_URL
```

You should see:
```
DATABASE_URL=postgresql://postgres:password@hostname:5432/railway
```

### 2. Check Database Connection in Logs

```bash
railway logs --tail 100 | grep -i database
```

Look for:
- ✅ `INFO: Configuring PostgreSQL database`
- ✅ `INFO: Database connection established.`
- ✅ `INFO: Database migrations synced.`

## Alternative: Use Railway Dashboard

If CLI doesn't work, use the dashboard:

1. Go to https://railway.app
2. Open project: **recall-v2-demo**
3. Click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
4. Railway automatically creates `DATABASE_URL` environment variable
5. Redeploy your application

## After Setup

Once PostgreSQL is added:

1. **Redeploy your application:**
   ```bash
   railway up
   ```

2. **Verify database connection:**
   ```bash
   railway logs --tail 50
   ```

3. **Check that migrations ran:**
   Look for: `INFO: Database migrations synced.`

## Troubleshooting

### If DATABASE_URL is not visible:

- Make sure you've linked to a service: `railway service <service-name>`
- PostgreSQL service must exist in your Railway project
- Check Railway dashboard to confirm PostgreSQL service is running

### If connection fails:

- Check logs for specific error: `railway logs --tail 100`
- Verify `NODE_ENV=production` is set (enables SSL)
- Ensure PostgreSQL service is running in Railway dashboard


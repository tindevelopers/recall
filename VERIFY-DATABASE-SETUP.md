# Verify Database Setup on Railway

## Quick Check Commands

Run these commands in your terminal to verify your database setup:

### 1. Link to Your Service

First, link to your main application service:

```bash
cd /Users/gene/Projects/recall
railway service <service-name>
```

Common service names: `web`, `api`, `main`, `v2-demo`, or check Railway dashboard.

### 2. Check Environment Variables

```bash
railway variables
```

**Look for these key variables:**

✅ **DATABASE_URL** - Should be set automatically by Railway PostgreSQL
   - Format: `postgresql://user:password@host:port/database`
   - If missing → Add PostgreSQL service in Railway dashboard

✅ **Required Variables:**
- `SECRET` - JWT secret key
- `RECALL_API_KEY` - Your Recall API key  
- `RECALL_API_HOST` - Should be `https://api.recall.ai`
- `PUBLIC_URL` - Your Railway domain
- `REDIS_URL` - Auto-set by Railway Redis
- `PORT` - Should be `3003`
- `NODE_ENV` - Should be `production`

### 3. Check Recent Logs

```bash
railway logs --tail 100
```

**Look for these log messages:**

✅ **Good signs:**
- `INFO: Configuring PostgreSQL database`
- `INFO: Using PostgreSQL database`
- `INFO: Database connection established.`
- `INFO: Database migrations synced.`

❌ **Error signs:**
- `❌ Database connection failed`
- `DATABASE_URL not set`
- `Using SQLite` (in production - should use PostgreSQL)
- `ECONNREFUSED` or connection errors

## Common Issues & Fixes

### Issue 1: DATABASE_URL Not Set

**Symptoms:**
- Logs show: `WARNING: DATABASE_URL not set - using SQLite`
- Database resets on redeploy

**Fix:**
1. Go to Railway dashboard: https://railway.app
2. Open your project: `recall-v2-demo`
3. Click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
4. Railway automatically creates `DATABASE_URL`
5. Redeploy your service

### Issue 2: Database Connection Failed

**Symptoms:**
- Logs show: `❌ Database connection failed`
- `ECONNREFUSED` errors

**Possible causes:**
1. PostgreSQL service not running
2. `DATABASE_URL` incorrectly formatted
3. Network/firewall issues
4. SSL configuration issues

**Fix:**
1. Check PostgreSQL service is running in Railway dashboard
2. Verify `DATABASE_URL` format:
   ```bash
   railway variables | grep DATABASE_URL
   ```
3. Check logs for specific error message
4. Ensure `NODE_ENV=production` is set (enables SSL)

### Issue 3: Wrong Database Type

**Symptoms:**
- Logs show: `Using SQLite` in production
- Database file gets reset

**Fix:**
- Ensure `DATABASE_URL` is set (see Issue 1)
- The app automatically uses PostgreSQL when `DATABASE_URL` is present

## Step-by-Step Verification

### Step 1: Check if PostgreSQL Service Exists

1. Go to Railway dashboard
2. Open project: `recall-v2-demo`
3. Look for a PostgreSQL service in the services list
4. If missing → Add it (see Issue 1 Fix)

### Step 2: Verify DATABASE_URL is Set

```bash
railway service <your-service-name>
railway variables | grep DATABASE_URL
```

Should show something like:
```
DATABASE_URL=postgresql://postgres:password@hostname:5432/railway
```

### Step 3: Check Database Connection in Logs

```bash
railway logs --tail 50 | grep -i database
```

Should see:
- `INFO: Configuring PostgreSQL database`
- `INFO: Database connection established.`

### Step 4: Verify Migrations Ran

```bash
railway logs --tail 100 | grep -i migration
```

Should see:
- `INFO: Database migrations synced.`

## Quick Fix Script

Run this to check everything:

```bash
./check-railway-env.sh
```

## Still Having Issues?

1. **Check Railway Dashboard:**
   - Verify PostgreSQL service exists and is running
   - Check service logs in Railway dashboard
   - Verify environment variables are set

2. **Check Application Logs:**
   ```bash
   railway logs --tail 200
   ```

3. **Verify Code Changes:**
   - Ensure `pg` and `pg-hstore` are in `package.json`
   - Ensure `db.js` has PostgreSQL support (already updated)
   - Redeploy after making changes

4. **Test Database Connection:**
   The app will log detailed error messages if connection fails.
   Check logs for specific error details.


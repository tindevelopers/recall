# Enable pgvector on Railway

Railway's standard PostgreSQL template does **not** include pgvector by default. You have two options:

## Option 1: Add New pgvector Database (Recommended - No Data Loss)

This is the safest approach if you have existing data.

### Step 1: Add pgvector PostgreSQL Service

1. Go to Railway Dashboard: https://railway.app
2. Open your project: `recall-v2-demo`
3. Click **"+ New"** → **"Database"** → Look for **"PostgreSQL with pgvector"** or **"PostgreSQL"** with pgvector support
4. Railway will create a new database service with pgvector pre-installed

### Step 2: Get the New Database URL

In Railway Dashboard:
1. Click on the new PostgreSQL service
2. Go to **"Variables"** tab
3. Copy the `DATABASE_URL` value

### Step 3: Update Your Services to Use New Database

For each service (main API and worker):
1. Go to service settings
2. Find `DATABASE_URL` variable
3. Update it to the new pgvector database URL
4. Or delete the old `DATABASE_URL` and Railway will auto-connect to the new database

### Step 4: Redeploy and Run Migrations

```bash
# Trigger redeploy (migrations will run automatically)
git commit --allow-empty -m "Trigger redeploy with pgvector"
git push origin main
```

The migrations will automatically:
- Detect pgvector is available
- Enable the extension
- Convert embeddings from JSON to vector type
- Create the vector index

### Step 5: Verify pgvector is Working

```bash
# Check logs for confirmation
railway logs --tail 100 | grep -i pgvector
```

Look for:
- `✅ pgvector extension enabled successfully`
- `✅ Successfully migrated embeddings to vector type`
- `✅ Successfully created vector index`

---

## Option 2: Test Current Database (May Not Work)

Railway's base PostgreSQL template typically doesn't have pgvector installed at the system level.

### Check if pgvector is Available

Run this script locally (requires Railway CLI):

```bash
cd /Users/gene/Projects/recall
railway run node scripts/enable-pgvector.js
```

This script will:
- ✅ Check if pgvector is available
- ✅ Attempt to enable it if available
- ✅ Show current embedding column type
- ✅ Test vector operations

### If pgvector is NOT Available

You'll see:
```
❌ pgvector extension is NOT available on this PostgreSQL instance
```

**Solution:** Use Option 1 above to add a pgvector-enabled database.

### If pgvector IS Available

The script will enable it automatically. Then:

1. **Re-run migrations to convert embeddings:**

```bash
# Connect to Railway and run migrations
railway run npm run migrate
```

2. **Verify the conversion:**

```bash
railway run node scripts/enable-pgvector.js
```

Should show:
```
✅ Embeddings are already using vector type!
✅ Vector operations are working!
```

---

## After Enabling pgvector

### Performance Improvements

With pgvector enabled:
- ⚡ **10-100x faster** similarity searches
- 🎯 Uses optimized C code and IVFFlat index
- 📊 Can handle millions of embeddings efficiently

Without pgvector (JavaScript fallback):
- 🐢 Slower (JavaScript computation)
- 📉 Limited to ~500 chunks per query
- ✅ Still functional for moderate usage

### Verify It's Working

Check application logs for:
```
Using PostgreSQL pgvector for similarity search
```

Or test the chat API:
```bash
curl -X POST https://your-app.railway.app/api/chat/meetings \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "What was discussed in the meeting?"}'
```

---

## Troubleshooting

### "extension 'vector' is not available"

This means pgvector is not installed at the system level. You need to:
1. Use Railway's pgvector template (Option 1)
2. Or contact Railway support to install pgvector on your current database

### Migrations Don't Convert Embeddings

Check:
1. Is pgvector extension enabled? Run: `railway run node scripts/enable-pgvector.js`
2. Are migrations running? Check logs for: `Database migrations synced`
3. Any migration errors? Check logs for: `MigrationError`

### Vector Search Still Slow

Check:
1. Is the vector index created? The migration `20260124091000-create-vector-index.js` should have run
2. Are embeddings in vector format? Run the check script
3. Is the application detecting pgvector? Check logs

---

## Current Status

Your application is currently:
- ✅ **Deployed and working** with JavaScript fallback
- ⚠️ **Using slower similarity search** (no pgvector)
- ✅ **Will automatically upgrade** when pgvector is available

No action required for basic functionality. Enable pgvector for better performance.


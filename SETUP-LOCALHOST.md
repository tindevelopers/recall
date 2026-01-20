# Setup Localhost with Remote Railway Database

This guide shows you how to run the application locally while connecting to the Railway PostgreSQL database.

## Step 1: Get Environment Variables from Railway

Run these commands to get your Railway environment variables:

```bash
cd /Users/gene/Projects/recall

# Link to your service
railway service v2-demo-worker

# Get DATABASE_URL
railway variables | grep "^DATABASE_URL"

# Get REDIS_URL (if you want to use remote Redis too)
railway variables | grep "^REDIS_URL"

# Get other required variables
railway variables | grep -E "(RECALL_API_KEY|RECALL_API_HOST|PUBLIC_URL|SECRET)"
```

## Step 2: Create Local .env File

Create a `.env` file in the `recall/` directory with your Railway variables:

```bash
cd /Users/gene/Projects/recall/recall
```

Create `.env` file with:

```env
# Database (from Railway)
DATABASE_URL=postgresql://postgres:password@hostname:5432/railway

# Redis (optional - use remote or local)
REDIS_URL=redis://default:password@hostname:6379
# Or for local Redis:
# REDIS_URL=redis://127.0.0.1:6379

# Recall API
RECALL_API_KEY=your_recall_api_key
RECALL_API_HOST=https://us-west-2.recall.ai

# Application
PUBLIC_URL=http://localhost:3003
SECRET=your_secret_key
NODE_ENV=development
PORT=3003

# OAuth (if needed)
GOOGLE_CALENDAR_OAUTH_CLIENT_ID=your_google_client_id
GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=your_google_client_secret
MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID=your_outlook_client_id
MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET=your_outlook_client_secret
```

**Important:** Replace the placeholder values with actual values from Railway.

## Step 3: Install Dependencies

```bash
cd /Users/gene/Projects/recall/recall
npm install
```

## Step 4: Run Database Migrations

The migrations will run automatically when you start the app, but you can verify the connection first:

```bash
# Test database connection
node -e "
import('./db.js').then(async ({connect}) => {
  try {
    await connect();
    console.log('✅ Database connection successful!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
});
"
```

## Step 5: Start the Application

### Option A: Run Main Application

```bash
cd /Users/gene/Projects/recall/recall
npm run dev
```

This will start the main application on `http://localhost:3003`

### Option B: Run Worker Service

```bash
cd /Users/gene/Projects/recall/recall
npm run dev:worker
```

This will start the worker service to process background jobs.

### Option C: Run Both (in separate terminals)

Terminal 1 (Main App):
```bash
cd /Users/gene/Projects/recall/recall
npm run dev
```

Terminal 2 (Worker):
```bash
cd /Users/gene/Projects/recall/recall
npm run dev:worker
```

## Step 6: Verify Connection

Check the logs to verify the database connection:

**Expected logs:**
- ✅ `INFO: Configuring PostgreSQL database`
- ✅ `INFO: PostgreSQL connection configured - Host: ..., Database: ...`
- ✅ `INFO: Database connection established.`
- ✅ `INFO: Database migrations synced.`

## Troubleshooting

### SSL Connection Error

If you see SSL connection errors, the database configuration has been updated to automatically enable SSL for Railway databases. Make sure you're using the latest code.

### Connection Refused

If you see `ECONNREFUSED`:
1. Verify `DATABASE_URL` is correct
2. Check Railway dashboard to ensure PostgreSQL service is running
3. Railway databases are accessible from anywhere, but verify the connection string format

### Authentication Failed

If you see authentication errors:
1. Verify `DATABASE_URL` password is correct
2. Get fresh credentials from Railway dashboard if needed
3. Railway may rotate credentials - check Railway dashboard

### Migrations Not Running

Migrations run automatically on startup. If they don't:
1. Check database connection logs
2. Verify you have write permissions (Railway databases should allow this)
3. Check for migration errors in logs

## Quick Setup Script

You can also use this script to quickly set up your `.env` file:

```bash
cd /Users/gene/Projects/recall
railway service v2-demo-worker
railway variables > railway-vars.txt

# Then manually copy the values you need to recall/.env
```

## Notes

- **SSL is automatically enabled** for Railway database connections (hostnames containing `railway.app` or `proxy.rlwy.net`)
- **Local development** uses `NODE_ENV=development` but SSL is still enabled for Railway databases
- **Public URL** should be `http://localhost:3003` for local development
- **Redis** can be local (`redis://127.0.0.1:6379`) or remote (Railway Redis URL)


# Quick Localhost Setup with Railway Database

## Step 1: Get DATABASE_URL from Railway

Run this command to see your DATABASE_URL:

```bash
# From project root
railway link   # or: railway service <your-service-name>
railway variables | grep -A 4 "DATABASE_URL"
```

The DATABASE_URL will be split across multiple lines. Combine them into one line:
```
postgresql://postgres:password@hostname:port/database
```

Example format:
```
postgresql://postgres:JkuCmXKLocLLrLRcgyTUXNbdnpFGcPYv@caboose.proxy.rlwy.net:55829/railway
```

## Step 2: Create .env File

Create `recall/.env` file with:

```env
# Database (combine the multi-line DATABASE_URL from Railway into one line)
DATABASE_URL=postgresql://postgres:password@hostname:port/database

# Redis (get from Railway or use local)
REDIS_URL=redis://default:password@hostname:6379
# Or for local Redis:
# REDIS_URL=redis://127.0.0.1:6379

# Recall API (get from Railway)
RECALL_API_KEY=your_key_here
RECALL_API_HOST=https://us-west-2.recall.ai

# Application
PUBLIC_URL=http://localhost:3003
SECRET=your_secret_here
NODE_ENV=development
PORT=3003
```

## Step 3: Install and Run

```bash
cd recall
npm install
npm run dev
```

## Important Notes

✅ **SSL is automatically enabled** for Railway databases (the code detects Railway hostnames)

✅ **Database connection** will work automatically - migrations run on startup

✅ **Check logs** for "Database connection established" to verify

## Troubleshooting

If you see SSL errors, make sure you're using the latest code (SSL is auto-enabled for Railway).

If connection fails, verify the DATABASE_URL is correct and all parts are on one line.


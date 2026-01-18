# Running V2 Demo Locally

This guide will help you set up and run the v2-demo application on your localhost.

## Prerequisites

1. **Node.js** (v16 or higher)
2. **Redis** - Required for the background job queue (Bull)
   - Option 1: Install Redis locally
     - macOS: `brew install redis` then `brew services start redis`
     - Linux: `sudo apt-get install redis-server` then `sudo systemctl start redis`
   - Option 2: Use Docker: `docker run -d -p 6379:6379 redis:6.2`
3. **Recall API Key** - Get yours from [Recall.ai](https://recall.ai)

## Quick Start

### Option 1: Automated Setup (Recommended)

```bash
cd v2-demo
./setup-local.sh    # Creates .env file with defaults
# Edit .env and add your RECALL_API_KEY and SECRET
npm install
./start-local.sh    # Checks prerequisites and starts server
```

### Option 2: Manual Setup

### 1. Install Dependencies

```bash
cd v2-demo
npm install
```

### 2. Set Up Environment Variables

Run the setup script or manually create `.env`:

```bash
./setup-local.sh
```

Or manually create `.env` with:
- `SECRET`: A random string for JWT signing (e.g., generate with `openssl rand -hex 32`)
- `RECALL_API_KEY`: Your Recall API key
- `RECALL_API_HOST`: Usually `https://api.recall.ai` (base URL only, without `/api/v1` or `/api/v2`)
- `PUBLIC_URL`: `http://localhost:3003` for local development
- `REDIS_URL`: `redis://localhost:6379` if Redis is running locally

### 3. Start Redis (if not already running)

**macOS:**
```bash
brew services start redis
# Or run manually: redis-server
```

**Linux:**
```bash
sudo systemctl start redis
# Or run manually: redis-server
```

**Docker:**
```bash
docker run -d -p 6379:6379 --name redis redis:6.2
```

### 4. Start the Application

You have two options:

#### Option A: Run with Docker Compose (Easiest)

```bash
docker compose -f docker-compose.local.yml up
```

This will start:
- Redis server
- Main application server
- Worker process

#### Option B: Run Manually (Two Terminals)

**Terminal 1 - Main Server:**
```bash
npm run dev
```

**Terminal 2 - Worker (for background jobs):**
```bash
npm run dev:worker
```

### 5. Access the Application

Open your browser and navigate to:
- **Main App**: http://localhost:3003

## Environment Variables Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `SECRET` | Yes | Secret key for JWT signing | - |
| `RECALL_API_KEY` | Yes | Your Recall API key | - |
| `RECALL_API_HOST` | Yes | Recall API base URL (without `/api/v1` or `/api/v2`) | `https://api.recall.ai` |
| `PUBLIC_URL` | Yes | Public URL for OAuth callbacks | `http://localhost:3003` |
| `REDIS_URL` | Yes | Redis connection URL | `redis://localhost:6379` |
| `PORT` | No | Server port | `3003` |
| `NODE_ENV` | No | Environment mode | `development` |
| `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` | Optional | Google OAuth client ID | - |
| `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` | Optional | Google OAuth client secret | - |
| `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` | Optional | Microsoft OAuth client ID | - |
| `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` | Optional | Microsoft OAuth client secret | - |

## Troubleshooting

### Redis Connection Error
If you see Redis connection errors:
1. Make sure Redis is running: `redis-cli ping` (should return `PONG`)
2. Check `REDIS_URL` in your `.env` file
3. For Docker Redis: `docker ps` to verify container is running

### Database Issues
**Local Development:**
- The app uses SQLite locally (creates `db.sqlite` file automatically)
- If you need to reset: `rm db.sqlite && npm run dev` (migrations run automatically)

**Production (Railway):**
- The app automatically uses PostgreSQL when `DATABASE_URL` is set
- PostgreSQL is recommended for production (better performance, persistence)
- No configuration needed - just add PostgreSQL service in Railway

### Port Already in Use
If port 3003 is already in use:
1. Change `PORT` in `.env` to a different port
2. Update `PUBLIC_URL` accordingly

## Development Notes

- The database migrations run automatically on startup
- SQLite database file: `db.sqlite` (created automatically)
- Logs are timestamped using `console-stamp`
- Hot reload is enabled via `nodemon` in development mode

## OAuth Setup (Optional)

If you want to test Google Calendar or Microsoft Outlook integration:

1. **Google Calendar:**
   - Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/)
   - Add authorized redirect URI: `http://localhost:3003/oauth-callback/google-calendar`
   - Add `GOOGLE_CALENDAR_OAUTH_CLIENT_ID` and `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` to `.env`

2. **Microsoft Outlook:**
   - Create app in [Azure Portal](https://portal.azure.com/)
   - Add redirect URI: `http://localhost:3003/oauth-callback/microsoft-outlook`
   - Add `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` and `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` to `.env`

## Using ngrok for Public URLs (if needed)

If you need a public URL for OAuth callbacks:

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3003
```

Then update `PUBLIC_URL` in `.env` to the ngrok URL (e.g., `https://abc123.ngrok.io`)

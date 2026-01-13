# Recall Calendar Integration Demo

V1 Demo - `./v1-demo/README.md`  
V2 Demo - `./v2-demo/README.md`

## Current Setup

### Client
A create react app serving as UI for calendar integration. Demo at https://recall-calendar-integration.pages.dev/

1. `npm install`
2. Create `.env` file from `.env.sample` and update values.
3. `npm start`

### Server
Express.js server for generating authentication tokens for using Calendar V1 APIs.

**Deployment**: The server is deployed using Express.js on Vercel (not Cloudflare Pages). The Express server is configured as serverless functions using `@vercel/node`.

1. `npm install`
2. Create `.env` file from `.env.sample` and update values.
3. `npm start`

**Vercel Configuration**:
- Framework Preset: **Express** (correct for Express.js server)
- Build Configuration: Uses `server/vercel.json` with `@vercel/node` builder
- Entry Point: `server/api/index.js`

## Configuration

- **Server Port**: 3010
- **Client Port**: 3011
- **API Region**: US West (`https://us-west-2.recall.ai`)
- **Microsoft OAuth**: Configured

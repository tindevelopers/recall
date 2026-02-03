import dotenv from "dotenv";
// Load environment variables immediately before any other imports that depend on them
dotenv.config();
// Redeploy marker - 2026-01-24

import path from "path";
import { fileURLToPath } from "url";
import consoleStamp from "console-stamp";
import express from "express";
import "express-async-errors";
import errorHandler from "errorhandler";
import cookieParser from "cookie-parser";

import { connect as connectDb, migrate as migrateDb } from "./db.js";
import router from "./routes/index.js";
import authenticate from "./middlewares/authenticate.js";
import notice from "./middlewares/notice.js";
import allowPutDeleteViaForms from "./middlewares/allow-put-delete-via-forms.js";
import Recall from "./services/recall/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
consoleStamp(console);

// Wrap everything in try-catch to ensure errors are logged
try {
  // Validate required environment variables
  const requiredEnvVars = [
    'SECRET',
    'RECALL_API_KEY',
    'RECALL_API_HOST',
    'PUBLIC_URL',
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName].trim() === '');

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\nPlease set these variables in Railway dashboard under your service settings.');
    process.exit(1);
  }

  console.log('✅ All required environment variables are set');

  // setup db & recall service
  console.log('📦 Connecting to database...');
  await connectDb();
  console.log('✅ Database connected');
  
  console.log('🔄 Running database migrations...');
  await migrateDb();
  console.log('✅ Migrations complete');
  
  console.log('🔧 Initializing Recall service...');
  Recall.initialize();
  console.log('✅ Recall service initialized');
} catch (error) {
  console.error('❌ Startup error:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
}

// setup express app
const app = express();
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(allowPutDeleteViaForms);
app.use(cookieParser());
app.use(authenticate);
app.use(notice);
app.use(router);

// Error handling middleware - must be last
app.use((err, req, res, next) => {
  // One-line log for Railway/grep: "500 /meetings TypeError: ..."
  const status = err.status || 500;
  console.error(`[ERROR] ${status} ${req.method} ${req.path} ${err.name || "Error"}: ${err.message}`);
  // Full details
  console.error('[ERROR] Request failed:', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
    status,
  });
  
  // Don't send response if headers already sent
  if (res.headersSent) {
    return next(err);
  }
  
  res.status(status);
  
  if (process.env.NODE_ENV === "development") {
    // only use in development
    console.log("Using errorhandler in development mode");
    return errorHandler()(err, req, res, next);
  }
  
  // Production error handler
  if (req.path.startsWith('/api/')) {
    return res.json({ error: 'Internal server error' });
  }
  
  // For non-API routes, try to render error page, fallback to simple text
  try {
    return res.render('error.ejs', { 
      error: 'Internal server error',
      status: status
    });
  } catch (renderErr) {
    console.error('[ERROR] Failed to render error page:', renderErr);
    // Last resort: send plain text
    return res.type('text').send(`Internal Server Error (${status})`);
  }
});

const port = process.env.PORT || 3003;
app.listen(port, '0.0.0.0', async () => {
  console.log(`✅ Started demo app on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Server ready at http://0.0.0.0:${port}`);
  console.log(`Deployment triggered: ${new Date().toISOString()} - Using RECALL_API_HOST: ${process.env.RECALL_API_HOST}`);
  
  // Run initial calendar connection check on startup
  try {
    const { checkCalendarConnections } = await import("./utils/check-calendar-connections.js");
    console.log(`[STARTUP] Running initial calendar connection status check...`);
    await checkCalendarConnections();
    console.log(`[STARTUP] ✅ Initial connection check complete`);
  } catch (error) {
    console.error(`[STARTUP] ⚠️  Failed to run initial connection check:`, error.message);
    // Don't fail startup if connection check fails
  }
}).on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

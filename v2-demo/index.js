import dotenv from "dotenv";
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

dotenv.config();
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  
  if (process.env.NODE_ENV === "development") {
    // only use in development
    console.log("Using errorhandler in development mode");
    return errorHandler()(err, req, res, next);
  }
  
  // Production error handler
  const status = err.status || 500;
  res.status(status);
  
  if (req.path.startsWith('/api/')) {
    res.json({ error: 'Internal server error' });
  } else {
    // For non-API routes, try to render error page, fallback to redirect
    try {
      res.render('error.ejs', { 
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
        status: status
      });
    } catch (renderErr) {
      // If error template fails, redirect to home
      res.redirect('/?error=internal_server_error');
    }
  }
});

const port = process.env.PORT || 3003;
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Started demo app on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Server ready at http://0.0.0.0:${port}`);
  console.log(`Deployment triggered: ${new Date().toISOString()}`);
}).on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

import dotenv from "dotenv";
import consoleStamp from "console-stamp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connect as connectDb } from "../db.js";
import { backgroundQueue } from "../queue.js";
import Recall from "../services/recall/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup file logging to debug.log
const debugLogPath = path.join(__dirname, "..", "debug.log");
const debugLogStream = fs.createWriteStream(debugLogPath, { flags: "a" });

// Enhanced logging function that writes to both console and debug.log
const telemetryLog = (level, message, data = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data,
    pid: process.pid,
    env: process.env.NODE_ENV || "development",
  };
  
  const logLine = JSON.stringify(logEntry) + "\n";
  debugLogStream.write(logLine);
  
  // Also log to console with appropriate level
  const consoleMessage = `[${level}] ${message}${Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : ""}`;
  if (level === "ERROR") {
    console.error(consoleMessage);
  } else if (level === "WARN") {
    console.warn(consoleMessage);
  } else {
    console.log(consoleMessage);
  }
};

import calendarWebhooksSave from "./processors/calendar-webhooks-save.js";
import calendarEventsUpdateAutorecord from "./processors/calendar-events-update-autorecord.js";
import calendarEventUpdateBotSchedule from "./processors/calendar-event-update-bot-schedule.js";
import calendarEventDeleteBot from './processors/calendar-event-delete-bot.js';
import recallCalendarUpdate from "./processors/recall-calendar-update.js";
import recallCalendarSyncEvents from "./processors/recall-calendar-sync-events.js";
import meetingEnrich from "./processors/meeting-enrich.js";
import publishingDispatch from "./processors/publishing-dispatch.js";
import periodicCalendarSync from "./processors/periodic-calendar-sync.js";

dotenv.config();
consoleStamp(console);

telemetryLog("INFO", "Worker startup initiated", {
  debugLogPath,
  nodeVersion: process.version,
  platform: process.platform,
});

console.log("🚀 Starting v2-demo worker...");
console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔗 Redis URL: ${process.env.REDIS_URL ? process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@') : 'NOT SET'}`);
console.log(`💾 Database: ${process.env.DATABASE_URL ? 'PostgreSQL (configured)' : 'NOT SET (DATABASE_URL required)'}`);
console.log(`📝 Debug log: ${debugLogPath}`);

telemetryLog("INFO", "Environment configuration", {
  nodeEnv: process.env.NODE_ENV || "development",
  redisUrlConfigured: !!process.env.REDIS_URL,
  databaseUrlConfigured: !!process.env.DATABASE_URL,
  publicUrl: process.env.PUBLIC_URL || "not-set",
});

// setup db & recall service
console.log("📦 Connecting to database...");
const dbStartTime = Date.now();
try {
  await connectDb();
  const dbConnectTime = Date.now() - dbStartTime;
  console.log("✅ Database connected");
  telemetryLog("INFO", "Database connection established", {
    connectionTimeMs: dbConnectTime,
    databaseType: "PostgreSQL",
  });
} catch (error) {
  telemetryLog("ERROR", "Database connection failed", {
    error: error.message,
    stack: error.stack,
  });
  throw error;
}

console.log("🔧 Initializing Recall service...");
const recallStartTime = Date.now();
try {
  Recall.initialize();
  const recallInitTime = Date.now() - recallStartTime;
  console.log("✅ Recall service initialized");
  telemetryLog("INFO", "Recall service initialized", {
    initTimeMs: recallInitTime,
    apiHost: process.env.RECALL_API_HOST || "not-set",
  });
} catch (error) {
  telemetryLog("ERROR", "Recall service initialization failed", {
    error: error.message,
    stack: error.stack,
  });
  throw error;
}


console.log("📥 Registering job processors...");
const processors = [
  { name: "calendarwebhooks.save", concurrency: 2, handler: calendarWebhooksSave },
  { name: "calendarevents.update_autorecord", concurrency: 2, handler: calendarEventsUpdateAutorecord },
  { name: "calendarevent.update_bot_schedule", concurrency: 2, handler: calendarEventUpdateBotSchedule },
  { name: "calendarevent.delete_bot", concurrency: 2, handler: calendarEventDeleteBot },
  { name: "recall.calendar.update", concurrency: 2, handler: recallCalendarUpdate },
  { name: "recall.calendar.sync_events", concurrency: 2, handler: recallCalendarSyncEvents },
  { name: "meeting.enrich", concurrency: 2, handler: meetingEnrich },
  { name: "publishing.dispatch", concurrency: 2, handler: publishingDispatch },
  { name: "periodic.calendar.sync", concurrency: 1, handler: periodicCalendarSync },
];

processors.forEach(({ name, concurrency, handler }) => {
  backgroundQueue.process(name, concurrency, handler);
  telemetryLog("INFO", "Job processor registered", {
    processorName: name,
    concurrency,
  });
});

console.log("✅ All job processors registered");
telemetryLog("INFO", "All job processors registered", {
  totalProcessors: processors.length,
});

backgroundQueue.on("ready", async () => {
  console.log("✅ Redis connection established - Queue is ready");
  console.log("🎯 Worker is now listening for jobs...");
  telemetryLog("INFO", "Redis queue ready", {
    queueName: backgroundQueue.name,
    redisUrl: process.env.REDIS_URL ? "configured" : "not-set",
  });

  // Schedule periodic calendar sync job (runs every 5 minutes)
  // This catches events that weren't picked up by webhooks
  try {
    // Remove any existing periodic sync jobs to avoid duplicates
    const existingJobs = await backgroundQueue.getRepeatableJobs();
    for (const job of existingJobs) {
      if (job.name === "periodic.calendar.sync") {
        await backgroundQueue.removeRepeatableByKey(job.key);
        console.log(`🗑️  Removed existing periodic sync job: ${job.key}`);
      }
    }

    // Add new periodic sync job (every 2 minutes for faster event detection)
    // Note: Recall.ai webhooks can be unreliable, so periodic sync is essential
    await backgroundQueue.add(
      "periodic.calendar.sync",
      {},
      {
        repeat: {
          every: 2 * 60 * 1000, // 2 minutes in milliseconds
        },
        jobId: "periodic-calendar-sync", // Unique ID to prevent duplicates
      }
    );

    console.log("⏰ Scheduled periodic calendar sync (every 2 minutes)");
    telemetryLog("INFO", "Periodic sync scheduled", {
      intervalMinutes: 2,
    });

    // Run initial sync immediately (don't wait 5 minutes)
    await backgroundQueue.add("periodic.calendar.sync", {}, { jobId: "periodic-calendar-sync-initial" });
    console.log("🔄 Triggered initial calendar sync");
  } catch (error) {
    console.error("❌ Failed to schedule periodic sync:", error);
    telemetryLog("ERROR", "Failed to schedule periodic sync", {
      error: error.message,
      stack: error.stack,
    });
  }
});

backgroundQueue.on("error", (error) => {
  console.error("❌ Queue error:", error);
  telemetryLog("ERROR", "Queue error", {
    error: error.message,
    code: error.code,
    stack: error.stack,
  });
});

backgroundQueue.on("active", async (job) => {
  const jobStartTime = Date.now();
  console.log(`▶️  [${job.queue.name}] Started job ${job.id} (${job.name})`);
  telemetryLog("INFO", "Job started", {
    jobId: job.id,
    jobName: job.name,
    queueName: job.queue.name,
    data: job.data,
    timestamp: jobStartTime,
  });
});

backgroundQueue.on("completed", async (job, result) => {
  const jobDuration = Date.now() - (job.processedOn || Date.now());
  console.log(`✅ [${job.queue.name}] Completed job ${job.id} (${job.name})`);
  telemetryLog("INFO", "Job completed", {
    jobId: job.id,
    jobName: job.name,
    queueName: job.queue.name,
    durationMs: jobDuration,
    attemptsMade: job.attemptsMade,
    result: result ? (typeof result === "object" ? JSON.stringify(result).substring(0, 200) : result) : null,
  });
});

backgroundQueue.on("failed", async (job, err) => {
  const jobDuration = job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null;
  console.error(`❌ [${job.queue.name}] Failed job ${job.id} (${job.name}):`, err.message);
  telemetryLog("ERROR", "Job failed", {
    jobId: job.id,
    jobName: job.name,
    queueName: job.queue.name,
    error: err.message,
    errorStack: err.stack,
    attemptsMade: job.attemptsMade,
    durationMs: jobDuration,
    data: job.data,
  });
});

backgroundQueue.on("stalled", async (job) => {
  console.warn(`⚠️  [${job.queue.name}] Stalled job ${job.id} (${job.name})`);
  telemetryLog("WARN", "Job stalled", {
    jobId: job.id,
    jobName: job.name,
    queueName: job.queue.name,
    attemptsMade: job.attemptsMade,
  });
});

process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down worker gracefully...");
  telemetryLog("INFO", "Worker shutdown initiated", { signal: "SIGINT" });
  try {
    await backgroundQueue.close();
    console.log("✅ Worker shut down complete");
    telemetryLog("INFO", "Worker shutdown complete", { signal: "SIGINT" });
  } catch (error) {
    telemetryLog("ERROR", "Error during shutdown", {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    debugLogStream.end();
    process.exit(0);
  }
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down worker...");
  telemetryLog("INFO", "Worker shutdown initiated", { signal: "SIGTERM" });
  try {
    await backgroundQueue.close();
    console.log("✅ Worker shut down complete");
    telemetryLog("INFO", "Worker shutdown complete", { signal: "SIGTERM" });
  } catch (error) {
    telemetryLog("ERROR", "Error during shutdown", {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    debugLogStream.end();
    process.exit(0);
  }
});

// Log uncaught exceptions
process.on("uncaughtException", (error) => {
  telemetryLog("ERROR", "Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });
  debugLogStream.end();
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  telemetryLog("ERROR", "Unhandled promise rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

console.log("🎉 Worker startup complete - Ready to process jobs!");
telemetryLog("INFO", "Worker startup complete", {
  uptime: process.uptime(),
  memoryUsage: process.memoryUsage(),
});

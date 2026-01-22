#!/usr/bin/env node
/**
 * Manual script to trigger calendar sync
 * Run this to manually sync calendar events when periodic sync isn't working
 */

import dotenv from "dotenv";
import { connect as connectDb } from "./db.js";
import { backgroundQueue } from "./queue.js";

dotenv.config();

async function triggerSync() {
  console.log("🔄 Manually triggering calendar sync...");
  
  try {
    await connectDb();
    console.log("✅ Database connected");
    
    // Add periodic sync job manually
    const job = await backgroundQueue.add("periodic.calendar.sync", {}, {
      jobId: `manual-sync-${Date.now()}`,
    });
    
    console.log(`✅ Sync job queued: ${job.id}`);
    console.log("⏳ Waiting for job to complete...");
    
    // Wait a bit for the job to process
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log("✅ Manual sync triggered!");
    console.log("Check Railway worker logs to see sync progress:");
    console.log("  railway logs --service v2-demo-worker --tail 100");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

triggerSync();



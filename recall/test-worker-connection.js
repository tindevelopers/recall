#!/usr/bin/env node
/**
 * Test script to verify worker service connection to main service
 * 
 * This script checks:
 * 1. Redis connection (shared queue)
 * 2. Database connection (shared database)
 * 3. Queue job processing capability
 * 4. Calendar sync status
 */

import dotenv from "dotenv";
import { connect as connectDb } from "./db.js";
import { backgroundQueue } from "./queue.js";

dotenv.config();

async function testWorkerConnection() {
  console.log("🔍 Testing Worker Service Connection\n");
  console.log("=" .repeat(60));

  // Test 1: Redis Connection
  console.log("\n1️⃣  Testing Redis Connection...");
  try {
    const redisClient = backgroundQueue.client;
    if (!redisClient) {
      console.log("   ❌ Redis client not initialized");
      return;
    }

    // Test Redis connection
    await new Promise((resolve, reject) => {
      redisClient.ping((err, result) => {
        if (err) {
          console.log(`   ❌ Redis connection failed: ${err.message}`);
          reject(err);
        } else {
          console.log(`   ✅ Redis connected: ${result}`);
          resolve();
        }
      });
    });

    // Check queue status
    const queueStats = await backgroundQueue.getJobCounts();
    console.log(`   📊 Queue stats:`, queueStats);
  } catch (error) {
    console.log(`   ❌ Redis test failed: ${error.message}`);
    return;
  }

  // Test 2: Database Connection
  console.log("\n2️⃣  Testing Database Connection...");
  try {
    await connectDb();
    console.log("   ✅ Database connected");
    
    // Test query
    const { Calendar } = await import("./models/calendar.js");
    const calendarCount = await Calendar.count();
    console.log(`   📊 Calendars in database: ${calendarCount}`);
  } catch (error) {
    console.log(`   ❌ Database test failed: ${error.message}`);
    return;
  }

  // Test 3: Queue Job Processing
  console.log("\n3️⃣  Testing Queue Job Processing...");
  try {
    // Add a test job
    const testJob = await backgroundQueue.add("periodic.calendar.sync", {}, {
      jobId: `test-connection-${Date.now()}`,
      removeOnComplete: true,
    });
    console.log(`   ✅ Test job added: ${testJob.id}`);
    
    // Check if job is in queue
    const job = await backgroundQueue.getJob(testJob.id);
    if (job) {
      console.log(`   ✅ Job found in queue: ${job.id}`);
    } else {
      console.log(`   ⚠️  Job not found (may have been processed)`);
    }
  } catch (error) {
    console.log(`   ❌ Queue job test failed: ${error.message}`);
    return;
  }

  // Test 4: Calendar Sync Status
  console.log("\n4️⃣  Testing Calendar Sync Status...");
  try {
    const { Calendar } = await import("./models/calendar.js");
    const calendars = await Calendar.findAll({
      limit: 5,
      order: [['createdAt', 'DESC']],
    });
    
    console.log(`   📊 Found ${calendars.length} calendars`);
    calendars.forEach((cal, idx) => {
      const email = cal.recallData?.platform_email || 'N/A';
      const status = cal.status || 'unknown';
      console.log(`   ${idx + 1}. ${email} - Status: ${status}`);
    });
  } catch (error) {
    console.log(`   ❌ Calendar sync test failed: ${error.message}`);
    return;
  }

  // Test 5: Check for gene@tin.info calendar
  console.log("\n5️⃣  Checking gene@tin.info calendar...");
  try {
    const { Calendar } = await import("./models/calendar.js");
    const { Sequelize } = await import("./db.js");
    
    const geneCalendar = await Calendar.findOne({
      where: Sequelize.where(
        Sequelize.literal("CAST(\"recallData\"->>'platform_email' AS TEXT)"),
        'gene@tin.info'
      ),
    });
    
    if (geneCalendar) {
      console.log(`   ✅ Found gene@tin.info calendar`);
      console.log(`   📧 Email: ${geneCalendar.recallData?.platform_email || 'N/A'}`);
      console.log(`   📊 Status: ${geneCalendar.status || 'unknown'}`);
      console.log(`   🆔 Recall ID: ${geneCalendar.recallId || 'N/A'}`);
      
      // Check for events
      const { CalendarEvent } = await import("./models/calendar-event.js");
      const eventCount = await CalendarEvent.count({
        where: { calendarId: geneCalendar.id },
      });
      console.log(`   📅 Events: ${eventCount}`);
    } else {
      console.log(`   ⚠️  gene@tin.info calendar not found`);
    }
  } catch (error) {
    console.log(`   ❌ Gene calendar check failed: ${error.message}`);
    return;
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Connection test completed!");
  console.log("\n💡 If all tests passed, the worker is connected correctly.");
  console.log("💡 If tests failed, check:");
  console.log("   - REDIS_URL environment variable");
  console.log("   - DATABASE_URL environment variable");
  console.log("   - Worker service is running");
  
  process.exit(0);
}

testWorkerConnection().catch((error) => {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
});


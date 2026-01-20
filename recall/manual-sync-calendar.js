#!/usr/bin/env node
/**
 * Manually trigger a calendar sync to fetch latest events from Recall.ai
 * 
 * Usage:
 *   node manual-sync-calendar.js <calendarId>
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables BEFORE importing db.js
const envPath = join(__dirname, ".env");
dotenv.config({ path: envPath });

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL not found in .env file");
  console.error(`   Expected at: ${envPath}`);
  process.exit(1);
}

// Now import modules that depend on DATABASE_URL
import db, { connect as connectDb } from "./db.js";
import Recall from "./services/recall/index.js";
import { backgroundQueue } from "./queue.js";

async function manualSync(calendarId) {
  try {
    console.log("🔄 Manual Calendar Sync");
    console.log("======================");
    console.log("");

    await connectDb();
    Recall.initialize();

    const calendar = await db.Calendar.findByPk(calendarId);
    if (!calendar) {
      console.error(`❌ Calendar ${calendarId} not found`);
      process.exit(1);
    }

    console.log(`✅ Found calendar: ${calendar.email || calendar.id}`);
    console.log(`   Platform: ${calendar.platform}`);
    console.log(`   Recall ID: ${calendar.recallId}`);
    console.log("");

    // Get events from Recall.ai (last 24 hours)
    const lastUpdatedTimestamp = new Date();
    lastUpdatedTimestamp.setHours(lastUpdatedTimestamp.getHours() - 24);
    
    console.log(`📥 Fetching events from Recall.ai since ${lastUpdatedTimestamp.toISOString()}...`);
    const events = await Recall.fetchCalendarEvents({
      id: calendar.recallId,
      lastUpdatedTimestamp: lastUpdatedTimestamp.toISOString(),
    });

    console.log(`✅ Found ${events.length} event(s) from Recall.ai`);
    console.log("");

    if (events.length > 0) {
      console.log("📋 Events:");
      events.forEach((event, idx) => {
        console.log(`   ${idx + 1}. ${event.title || "Untitled"}`);
        console.log(`      ID: ${event.id}`);
        console.log(`      Start: ${event.start_time || "Not set"}`);
        console.log(`      Meeting URL: ${event.meeting_url ? "Yes" : "No"}`);
        console.log(`      Updated: ${event.updated_at || "Not set"}`);
        console.log("");
      });
    }

    // Sync events to database
    console.log("💾 Syncing events to database...");
    let eventsUpserted = [];
    for (const event of events) {
      if (event["is_deleted"]) {
        await db.CalendarEvent.destroy({
          where: {
            recallId: event.id,
            calendarId: calendar.id,
          },
        });
      } else {
        const [instance, created] = await db.CalendarEvent.upsert({
          recallId: event.id,
          recallData: event,
          platform: event.platform,
          updatedAt: new Date(),
          calendarId: calendar.id,
        });
        eventsUpserted.push(event);
        if (created) {
          console.log(`   ✅ Created: ${event.title || "Untitled"}`);
        } else {
          console.log(`   🔄 Updated: ${event.title || "Untitled"}`);
        }
      }
    }

    console.log(`✅ Synced ${eventsUpserted.length} event(s) to database`);
    console.log("");

    // Update auto-record status and schedule bots
    if (eventsUpserted.length > 0) {
      console.log("🤖 Updating auto-record status and scheduling bots...");
      
      const { updateAutoRecordStatusForCalendarEvents } = await import("./logic/autorecord.js");
      const dbEvents = await db.CalendarEvent.findAll({
        where: {
          recallId: { [db.Sequelize.Op.in]: eventsUpserted.map(e => e.id) },
          calendarId: calendar.id,
        },
      });

      await updateAutoRecordStatusForCalendarEvents({
        calendar,
        events: dbEvents,
      });

      // Queue bot scheduling jobs
      for (const event of dbEvents) {
        await backgroundQueue.add("calendarevent.update_bot_schedule", {
          calendarId: calendar.id,
          recallEventId: event.recallId,
        });
      }

      console.log(`✅ Queued ${dbEvents.length} bot scheduling job(s)`);
      console.log("");
      console.log("⏳ Bot scheduling jobs will be processed by the worker service");
      console.log("   Check Railway logs for: [BOT_CONFIG] Bot scheduled successfully");
    }

    console.log("✅ Manual sync completed!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.res) {
      try {
        const errorBody = await error.res.text();
        console.error("API Error Response:", errorBody);
      } catch (e) {
        console.error("Could not read error response");
      }
    }
    process.exit(1);
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);
  
  if (!args[0]) {
    console.log("Usage: node manual-sync-calendar.js <calendarId>");
    console.log("");
    console.log("Example:");
    console.log("  node manual-sync-calendar.js 3b79831b-842b-4521-9211-8984bb0e818e");
    process.exit(1);
  }

  await manualSync(args[0]);
}

main();

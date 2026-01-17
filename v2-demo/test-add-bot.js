#!/usr/bin/env node
/**
 * Test script to add a bot to a Recall.ai calendar event
 * 
 * Usage:
 *   node test-add-bot.js <recallEventId> [meetingUrl]
 *   node test-add-bot.js --create-test-event
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
import { buildBotConfig } from "./logic/bot-config.js";

async function addBotToEvent(recallEventId, meetingUrl = null) {
  try {
    console.log("🤖 Adding Bot to Recall Calendar Event");
    console.log("======================================");
    console.log("");

    // Initialize Recall service
    Recall.initialize();

    // Get the event from our database if it exists
    let calendarEvent = null;
    let calendar = null;

    try {
      calendarEvent = await db.CalendarEvent.findOne({
        where: { recallId: recallEventId },
        include: [{ model: db.Calendar }],
      });
      if (calendarEvent) {
        calendar = calendarEvent.Calendar;
        console.log(`✅ Found event in database:`);
        console.log(`   Event ID: ${calendarEvent.id}`);
        console.log(`   Title: ${calendarEvent.title || "Untitled"}`);
        console.log(`   Start Time: ${calendarEvent.startTime}`);
        console.log(`   Meeting URL: ${calendarEvent.meetingUrl || "Not set"}`);
        console.log("");
      }
    } catch (error) {
      console.log("⚠️  Event not found in local database, will use Recall API directly");
    }

    // Build bot config - prefer remote PUBLIC_URL if available
    let publicUrl = process.env.PUBLIC_URL;
    if (!publicUrl || publicUrl.includes('localhost')) {
      // Try to get from Railway if localhost
      try {
        const { execSync } = await import('child_process');
        const railwayVars = JSON.parse(execSync('railway variables --json', { encoding: 'utf-8' }));
        if (railwayVars.PUBLIC_URL && !railwayVars.PUBLIC_URL.includes('localhost')) {
          publicUrl = railwayVars.PUBLIC_URL;
          console.log(`✅ Using remote PUBLIC_URL: ${publicUrl}`);
        }
      } catch (e) {
        // Fallback to localhost if Railway CLI not available
        if (!publicUrl) publicUrl = "http://localhost:3003";
      }
    }
    const botConfig = buildBotConfig({ calendar, publicUrl });

    // Calculate join_at time (10 minutes from now for testing)
    const joinAtTime = new Date();
    joinAtTime.setMinutes(joinAtTime.getMinutes() + 10);
    botConfig.join_at = joinAtTime.toISOString();

    // Add deduplication key
    const deduplicationKey = `test-${Date.now()}`;

    console.log("📤 Bot Configuration:");
    console.log(JSON.stringify(botConfig, null, 2));
    console.log("");
    console.log(`⏰ Bot will join at: ${botConfig.join_at}`);
    console.log("");

    // Add bot to the event
    console.log("🚀 Adding bot to Recall.ai...");
    const result = await Recall.addBotToCalendarEvent({
      id: recallEventId,
      deduplicationKey,
      botConfig,
    });

    console.log("✅ Bot added successfully!");
    console.log("");
    console.log("📊 Response from Recall API:");
    console.log(JSON.stringify(result, null, 2));
    console.log("");
    
    // Try to extract bot information from various response formats
    let botId = null;
    if (result.bots && Array.isArray(result.bots) && result.bots.length > 0) {
      const bot = result.bots[0];
      botId = bot.bot_id || bot.id;
      console.log("📊 Bot Details:");
      console.log(`   Bot ID: ${botId}`);
      console.log(`   Start Time: ${bot.start_time || bot.join_at || "Not set"}`);
      console.log(`   Deduplication Key: ${bot.deduplication_key || "Not set"}`);
      console.log(`   Meeting URL: ${bot.meeting_url ? "Yes" : "Not set"}`);
      if (bot.status) {
        console.log(`   Status: ${bot.status}`);
      }
    } else if (result.bot) {
      botId = result.bot.id || result.bot.bot_id;
      console.log("📊 Bot Details:");
      console.log(`   Bot ID: ${botId}`);
      console.log(`   Status: ${result.bot.status || "Not available"}`);
    } else if (result.id) {
      console.log("📊 Event Updated:");
      console.log(`   Event ID: ${result.id}`);
      if (result.bots && Array.isArray(result.bots)) {
        console.log(`   Bots: ${result.bots.length} bot(s) associated`);
        if (result.bots.length > 0) {
          botId = result.bots[0].bot_id || result.bots[0].id;
          console.log(`   First Bot ID: ${botId}`);
        }
      }
    }
    console.log("");
    console.log("🔍 Check bot status in Recall dashboard:");
    console.log(`   https://us-west-2.recall.ai/dashboard/explorer/bot`);
    if (botId) {
      console.log(`   Or view specific bot: https://us-west-2.recall.ai/dashboard/explorer/bot/${botId}`);
    }
    console.log("");

    return result;
  } catch (error) {
    console.error("❌ Error adding bot:", error.message);
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

async function createTestEvent() {
  try {
    console.log("📅 Creating test calendar event...");
    
    Recall.initialize();
    
    // Get first calendar
    const calendars = await db.Calendar.findAll({ limit: 1 });
    if (calendars.length === 0) {
      console.error("❌ No calendars found. Please connect a calendar first.");
      process.exit(1);
    }
    
    const calendar = calendars[0];
    console.log(`✅ Using calendar: ${calendar.email || calendar.id}`);
    
    // Create a test event 15 minutes from now
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() + 15);
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + 30);
    
    // This would require creating an event via the calendar provider API
    // For now, we'll just show instructions
    console.log("");
    console.log("⚠️  To create a test event:");
    console.log("   1. Create a calendar event in Google Calendar or Outlook");
    console.log("   2. Add a meeting URL (Zoom, Teams, etc.)");
    console.log("   3. Wait for it to sync to Recall.ai");
    console.log("   4. Then run: node test-add-bot.js <recallEventId>");
    console.log("");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Main
async function main() {
  await connectDb();
  
  const args = process.argv.slice(2);
  
  if (args[0] === "--create-test-event" || args[0] === "--create") {
    await createTestEvent();
  } else if (args[0]) {
    await addBotToEvent(args[0], args[1]);
  } else {
    console.log("Usage:");
    console.log("  node test-add-bot.js <recallEventId> [meetingUrl]");
    console.log("  node test-add-bot.js --create-test-event");
    console.log("");
    console.log("Example:");
    console.log("  node test-add-bot.js abc123-def456-ghi789");
    process.exit(1);
  }
  
  process.exit(0);
}

main();

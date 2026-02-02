/**
 * Check upcoming meetings in Railway database for a specific calendar
 * 
 * Usage: RAILWAY_ENVIRONMENT=production node check-railway-upcoming-meetings.js <calendarId>
 * 
 * Or set DATABASE_URL to Railway's database URL directly
 */

import dotenv from "dotenv";
dotenv.config();

import db, { connect as connectDb } from "./db.js";
import { Op } from "sequelize";

async function checkUpcomingMeetings(calendarId) {
  console.log("🔍 Checking upcoming meetings in Railway database\n");
  
  await connectDb();
  console.log("✅ Connected to database\n");

  // Try to find calendar by both database ID and recallId
  const calendarById = await db.Calendar.findByPk(calendarId);
  const calendarByRecallId = await db.Calendar.findOne({
    where: { recallId: calendarId }
  });
  
  const calendar = calendarById || calendarByRecallId;
  
  if (!calendar) {
    console.log(`❌ Calendar not found with ID: ${calendarId}`);
    console.log("\n💡 Trying to find similar calendars...\n");
    
    const allCalendars = await db.Calendar.findAll({
      attributes: ['id', 'email', 'platform', 'recallId', 'userId'],
      limit: 20
    });
    
    console.log(`Found ${allCalendars.length} calendars:`);
    allCalendars.forEach(c => {
      console.log(`  - DB ID: ${c.id}`);
      console.log(`    Recall ID: ${c.recallId}`);
      console.log(`    Email: ${c.email}`);
      console.log(`    Platform: ${c.platform}`);
      console.log("");
    });
    
    // Check if any calendar ID or recallId contains part of the search ID
    const partialMatch = allCalendars.find(c => 
      c.id.includes(calendarId.substring(0, 8)) || 
      c.recallId.includes(calendarId.substring(0, 8))
    );
    
    if (partialMatch) {
      console.log(`\n💡 Found partial match:`);
      console.log(`   DB ID: ${partialMatch.id}`);
      console.log(`   Recall ID: ${partialMatch.recallId}`);
      console.log(`   Email: ${partialMatch.email}`);
    }
    
    process.exit(1);
  }

  console.log(`✅ Found calendar:`);
  console.log(`   Database ID: ${calendar.id}`);
  console.log(`   Recall ID: ${calendar.recallId}`);
  console.log(`   Email: ${calendar.email}`);
  console.log(`   Platform: ${calendar.platform}`);
  console.log(`   User ID: ${calendar.userId}`);
  console.log("");

  // Get all events for this calendar
  const allEvents = await db.CalendarEvent.findAll({
    where: { calendarId: calendar.id },
    include: [{ model: db.Calendar }],
    limit: 1000,
    order: [["createdAt", "DESC"]],
  });

  console.log(`📅 Found ${allEvents.length} total events in database\n`);

  if (allEvents.length === 0) {
    console.log("❌ No events found!");
    console.log("\n💡 Possible issues:");
    console.log("   - Events haven't been synced from Recall.ai yet");
    console.log("   - Calendar sync failed");
    console.log("   - Events were deleted");
    process.exit(0);
  }

  // Analyze events
  const now = new Date();
  const futureEvents = [];
  const pastEvents = [];
  const eventsWithoutStartTime = [];

  for (const event of allEvents) {
    try {
      const startTime = event.startTime;
      if (!startTime) {
        eventsWithoutStartTime.push({
          id: event.id,
          recallId: event.recallId,
          title: event.title,
        });
        continue;
      }

      const startDate = new Date(startTime);
      if (isNaN(startDate.getTime())) {
        eventsWithoutStartTime.push({
          id: event.id,
          recallId: event.recallId,
          title: event.title,
          reason: 'invalid_date',
          startTimeValue: startTime,
        });
        continue;
      }

      if (startDate >= now) {
        futureEvents.push({
          id: event.id,
          recallId: event.recallId,
          title: event.title,
          startTime: startDate.toISOString(),
          meetingUrl: event.meetingUrl,
          calendarId: event.calendarId,
        });
      } else {
        pastEvents.push({
          id: event.id,
          recallId: event.recallId,
          title: event.title,
          startTime: startDate.toISOString(),
        });
      }
    } catch (error) {
      eventsWithoutStartTime.push({
        id: event.id,
        recallId: event.recallId,
        title: event.title,
        reason: 'parse_error',
        error: error.message,
      });
    }
  }

  console.log(`📊 Event Analysis:`);
  console.log(`   Future events: ${futureEvents.length}`);
  console.log(`   Past events: ${pastEvents.length}`);
  console.log(`   Events without valid startTime: ${eventsWithoutStartTime.length}`);
  console.log("");

  if (futureEvents.length > 0) {
    console.log(`✅ Future Events (should appear in frontend):`);
    futureEvents.forEach((event, idx) => {
      console.log(`\n   ${idx + 1}. ${event.title}`);
      console.log(`      Database Event ID: ${event.id}`);
      console.log(`      Recall Event ID: ${event.recallId}`);
      console.log(`      Start: ${event.startTime}`);
      console.log(`      Meeting URL: ${event.meetingUrl ? 'Yes' : 'No'}`);
      console.log(`      Calendar DB ID: ${event.calendarId}`);
    });
  } else {
    console.log(`❌ No future events found!`);
    console.log("\n💡 This explains why meetings don't show in frontend.");
    
    if (pastEvents.length > 0) {
      console.log(`\n   Found ${pastEvents.length} past events (most recent 5):`);
      pastEvents.slice(0, 5).forEach((event, idx) => {
        console.log(`   ${idx + 1}. ${event.title} - ${event.startTime}`);
      });
    }
    
    if (eventsWithoutStartTime.length > 0) {
      console.log(`\n   Found ${eventsWithoutStartTime.length} events without valid startTime:`);
      eventsWithoutStartTime.slice(0, 5).forEach((event, idx) => {
        console.log(`   ${idx + 1}. ${event.title}`);
        console.log(`      Reason: ${event.reason || 'no_startTime'}`);
      });
    }
  }

  // Check user association
  const user = await db.User.findByPk(calendar.userId);
  if (!user) {
    console.log(`\n⚠️  Warning: Calendar's userId (${calendar.userId}) doesn't match any user!`);
  } else {
    console.log(`\n✅ Calendar is associated with user: ${user.email || user.id}`);
  }

  console.log(`\n📋 Summary:`);
  console.log(`   Calendar DB ID: ${calendar.id}`);
  console.log(`   Calendar Recall ID: ${calendar.recallId}`);
  console.log(`   Total events: ${allEvents.length}`);
  console.log(`   Future events: ${futureEvents.length}`);
  console.log(`   Past events: ${pastEvents.length}`);
  console.log(`   Events without startTime: ${eventsWithoutStartTime.length}`);

  process.exit(0);
}

const calendarId = process.argv[2];
if (!calendarId) {
  console.error("Usage: node check-railway-upcoming-meetings.js <calendarId>");
  console.error("Example: node check-railway-upcoming-meetings.js 039a4ad4-1257-4ad1-9ef4-3096bc1c8f98");
  console.error("\nOr set RAILWAY_ENVIRONMENT=production and ensure DATABASE_URL points to Railway database");
  process.exit(1);
}

checkUpcomingMeetings(calendarId).catch(console.error);

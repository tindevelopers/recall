/**
 * Debug script to check why upcoming meetings aren't showing in frontend
 * 
 * Run: node debug-upcoming-meetings.js <calendarId>
 * Example: node debug-upcoming-meetings.js 039a4ad4-1257-4ad1-9ef4-3096bc1c8f98
 */

import dotenv from "dotenv";
dotenv.config();

import db, { connect as connectDb } from "./db.js";
import { Op } from "sequelize";

async function debugUpcomingMeetings(calendarId) {
  await connectDb();
  console.log("Connected to database\n");

  // Find the calendar
  const calendar = await db.Calendar.findByPk(calendarId);
  if (!calendar) {
    console.log(`❌ Calendar ${calendarId} not found in database`);
    console.log("\nAvailable calendars:");
    const allCalendars = await db.Calendar.findAll({
      attributes: ['id', 'email', 'platform', 'recallId', 'userId'],
    });
    allCalendars.forEach(c => {
      console.log(`  - ${c.id} (${c.email}, ${c.platform}, userId: ${c.userId})`);
    });
    process.exit(1);
  }

  console.log(`✅ Found calendar:`);
  console.log(`   ID: ${calendar.id}`);
  console.log(`   Email: ${calendar.email}`);
  console.log(`   Platform: ${calendar.platform}`);
  console.log(`   Recall ID: ${calendar.recallId}`);
  console.log(`   User ID: ${calendar.userId}`);
  console.log("");

  // Get all events for this calendar
  const allEvents = await db.CalendarEvent.findAll({
    where: { calendarId: calendar.id },
    include: [{ model: db.Calendar }],
    limit: 1000,
  });

  console.log(`📅 Found ${allEvents.length} total events in database for this calendar\n`);

  if (allEvents.length === 0) {
    console.log("❌ No events found in database!");
    console.log("\n💡 Possible issues:");
    console.log("   - Events haven't been synced from Recall.ai yet");
    console.log("   - Calendar sync failed");
    console.log("   - Events were deleted");
    console.log("\n🔧 Try:");
    console.log("   - Check if calendar sync is running");
    console.log("   - Manually trigger sync: POST /api/trigger-calendar-sync");
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
    futureEvents.slice(0, 10).forEach((event, idx) => {
      console.log(`   ${idx + 1}. ${event.title}`);
      console.log(`      ID: ${event.id}`);
      console.log(`      Recall ID: ${event.recallId}`);
      console.log(`      Start: ${event.startTime}`);
      console.log(`      Meeting URL: ${event.meetingUrl ? 'Yes' : 'No'}`);
      console.log("");
    });
    if (futureEvents.length > 10) {
      console.log(`   ... and ${futureEvents.length - 10} more`);
    }
  } else {
    console.log(`❌ No future events found!`);
    console.log("\n💡 This explains why meetings don't show in frontend.");
    console.log("\n🔍 Checking why events are not future:");
    
    if (pastEvents.length > 0) {
      console.log(`\n   Found ${pastEvents.length} past events:`);
      pastEvents.slice(0, 5).forEach((event, idx) => {
        console.log(`   ${idx + 1}. ${event.title} - ${event.startTime}`);
      });
    }
    
    if (eventsWithoutStartTime.length > 0) {
      console.log(`\n   Found ${eventsWithoutStartTime.length} events without valid startTime:`);
      eventsWithoutStartTime.slice(0, 5).forEach((event, idx) => {
        console.log(`   ${idx + 1}. ${event.title}`);
        console.log(`      Reason: ${event.reason || 'no_startTime'}`);
        if (event.startTimeValue) {
          console.log(`      Value: ${event.startTimeValue}`);
        }
        if (event.error) {
          console.log(`      Error: ${event.error}`);
        }
      });
    }
  }

  // Check if calendar is associated with any user
  const user = await db.User.findByPk(calendar.userId);
  if (!user) {
    console.log(`\n⚠️  Warning: Calendar's userId (${calendar.userId}) doesn't match any user!`);
    console.log("   This could cause meetings not to show if queries filter by userId.");
  } else {
    console.log(`\n✅ Calendar is associated with user: ${user.email || user.id}`);
  }

  // Check what the meetings list route would query
  console.log(`\n🔍 Simulating meetings list query:`);
  const calendarIds = [calendar.id];
  const simulatedEvents = await db.CalendarEvent.findAll({
    where: {
      calendarId: { [Op.in]: calendarIds },
    },
    include: [{ model: db.Calendar }],
    limit: 1000,
  });
  
  const simulatedFutureEvents = simulatedEvents.filter(event => {
    try {
      const startTime = event.startTime;
      if (!startTime) return false;
      const startDate = new Date(startTime);
      if (isNaN(startDate.getTime())) return false;
      return startDate >= now;
    } catch {
      return false;
    }
  });

  console.log(`   Query would find: ${simulatedEvents.length} total events`);
  console.log(`   After future filter: ${simulatedFutureEvents.length} events`);
  console.log(`   This matches our analysis: ${simulatedFutureEvents.length === futureEvents.length ? '✅' : '❌'}`);

  process.exit(0);
}

const calendarId = process.argv[2];
if (!calendarId) {
  console.error("Usage: node debug-upcoming-meetings.js <calendarId>");
  console.error("Example: node debug-upcoming-meetings.js 039a4ad4-1257-4ad1-9ef4-3096bc1c8f98");
  process.exit(1);
}

debugUpcomingMeetings(calendarId).catch(console.error);

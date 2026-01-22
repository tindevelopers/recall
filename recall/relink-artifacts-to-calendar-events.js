/**
 * Script to re-link MeetingArtifacts to their CalendarEvents
 * 
 * This fixes the issue where past meetings show "Meeting on [date]" instead of
 * proper titles and descriptions because the artifact wasn't linked to its calendar event.
 * 
 * Matching strategies:
 * 1. Match by thread_id from artifact's meeting_url object to calendar event's meeting_url string
 * 2. Match by start_time (within a small window)
 */

import db, { connect } from "./db.js";
import { Op } from "sequelize";

/**
 * Extract thread_id from a Teams meeting URL string
 * Example: https://teams.microsoft.com/l/meetup-join/19:meeting_MjMzY2ZlMzQtZDAyZC00NWRhLWE1YjEtZmI2YmE3YmYwODRm@thread.v2/...
 */
function extractThreadIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/19:meeting_[^@/]+@thread\.v2/);
  return match ? match[0] : null;
}

async function relinkArtifacts() {
  // Initialize database connection and models
  await connect();

  console.log("Starting artifact re-linking process...\n");

  // Get all artifacts that don't have a calendarEventId
  const unlinkedArtifacts = await db.MeetingArtifact.findAll({
    where: {
      calendarEventId: null,
    },
    order: [["createdAt", "DESC"]],
  });

  console.log(`Found ${unlinkedArtifacts.length} unlinked artifacts\n`);

  // Pre-fetch all calendar events and index by thread_id for fast lookup
  const allCalendarEvents = await db.CalendarEvent.findAll();
  const eventsByThreadId = new Map();
  const eventsByStartTime = new Map();

  for (const event of allCalendarEvents) {
    const meetingUrl = event.recallData?.meeting_url;
    const threadId = extractThreadIdFromUrl(meetingUrl);
    if (threadId) {
      if (!eventsByThreadId.has(threadId)) {
        eventsByThreadId.set(threadId, []);
      }
      eventsByThreadId.get(threadId).push(event);
    }

    // Also index by start time (rounded to minute)
    const startTime = event.recallData?.start_time;
    if (startTime) {
      const startMinute = new Date(startTime).toISOString().substring(0, 16); // YYYY-MM-DDTHH:MM
      if (!eventsByStartTime.has(startMinute)) {
        eventsByStartTime.set(startMinute, []);
      }
      eventsByStartTime.get(startMinute).push(event);
    }
  }

  console.log(`Indexed ${allCalendarEvents.length} calendar events`);
  console.log(`  - ${eventsByThreadId.size} unique thread IDs`);
  console.log(`  - ${eventsByStartTime.size} unique start times\n`);

  let linkedCount = 0;
  let failedCount = 0;
  const results = [];

  for (const artifact of unlinkedArtifacts) {
    const data = artifact.rawPayload?.data || {};
    const meetingUrlObj = data.meeting_url;
    const startTime = data.start_time;
    const title = data.title;

    let calendarEvent = null;
    let matchMethod = null;

    // Strategy 1: Match by thread_id
    if (meetingUrlObj && typeof meetingUrlObj === 'object' && meetingUrlObj.thread_id) {
      const threadId = meetingUrlObj.thread_id;
      const matchingEvents = eventsByThreadId.get(threadId) || [];
      
      if (matchingEvents.length === 1) {
        calendarEvent = matchingEvents[0];
        matchMethod = "thread_id";
      } else if (matchingEvents.length > 1 && startTime) {
        // Multiple matches - narrow down by start time
        const artifactStart = new Date(startTime);
        for (const event of matchingEvents) {
          const eventStart = new Date(event.recallData?.start_time);
          const timeDiff = Math.abs(artifactStart - eventStart);
          // Within 15 minutes
          if (timeDiff < 15 * 60 * 1000) {
            calendarEvent = event;
            matchMethod = "thread_id + start_time";
            break;
          }
        }
      }
    }

    // Strategy 2: Match by start_time only (if no thread_id match)
    if (!calendarEvent && startTime) {
      const startMinute = new Date(startTime).toISOString().substring(0, 16);
      const matchingEvents = eventsByStartTime.get(startMinute) || [];
      
      if (matchingEvents.length === 1) {
        calendarEvent = matchingEvents[0];
        matchMethod = "start_time";
      }
    }

    if (calendarEvent) {
      // Update the artifact with the calendar event ID
      await artifact.update({ calendarEventId: calendarEvent.id });
      linkedCount++;
      results.push({
        artifactId: artifact.id,
        title: title || "Unknown",
        matchMethod,
        calendarEventId: calendarEvent.id,
        calendarEventTitle: calendarEvent.title,
        status: "linked",
      });
      if (linkedCount <= 20 || linkedCount % 100 === 0) {
        console.log(`✓ Linked artifact "${title || artifact.id.substring(0,8)}" via ${matchMethod} -> "${calendarEvent.title}"`);
      }
    } else {
      failedCount++;
      results.push({
        artifactId: artifact.id,
        title: title || "Unknown",
        threadId: meetingUrlObj?.thread_id,
        startTime,
        status: "not_linked",
        reason: "No matching calendar event found",
      });
      if (failedCount <= 10) {
        console.log(`✗ Could not link artifact "${title || artifact.id.substring(0,8)}"`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Re-linking complete!`);
  console.log(`  Linked: ${linkedCount}`);
  console.log(`  Failed: ${failedCount}`);
  console.log(`  Total:  ${unlinkedArtifacts.length}`);
  console.log("=".repeat(60));

  // Show detailed results for failed ones
  const failed = results.filter((r) => r.status === "not_linked");
  if (failed.length > 0 && failed.length <= 20) {
    console.log("\nFailed to link:");
    for (const f of failed) {
      console.log(`  - ${f.title}: ${f.reason}`);
      if (f.threadId) {
        console.log(`    thread_id: ${f.threadId}`);
      }
      if (f.startTime) {
        console.log(`    start_time: ${f.startTime}`);
      }
    }
  }

  return { linkedCount, failedCount, total: unlinkedArtifacts.length };
}

// Run the script
relinkArtifacts()
  .then((result) => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });

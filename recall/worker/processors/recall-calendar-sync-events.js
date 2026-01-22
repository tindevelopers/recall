import Recall from "../../services/recall/index.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

export default async (job) => {
  const { calendarId, recallId, lastUpdatedTimestamp } = job.data;
  
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:job_start',message:'Sync events job started',data:{calendarId,recallId,lastUpdatedTimestamp},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-job-1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  
  console.log(
    `INFO: Sync events for calendar ${calendarId}(recall_id: ${recallId}) since ${lastUpdatedTimestamp}`
  );
  
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:before_fetch',message:'Before fetching events from Recall API',data:{calendarId,recallId,lastUpdatedTimestamp},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-job-1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  
  const events = await Recall.fetchCalendarEvents({
    id: recallId,
    lastUpdatedTimestamp,
  });
  
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:after_fetch',message:'After fetching events from Recall API',data:{calendarId,recallId,eventsCount:events.length,eventIds:events.slice(0,3).map(e=>e.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-job-1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

  let eventsUpserted = [];
  let eventsDeleted = [];
  for (const event of events) {
    if (event["is_deleted"]) {
      await db.CalendarEvent.destroy({
        where: {
          recallId: event.id,
          calendarId: calendarId,
        },
      });
      eventsDeleted.push(event);
    } else {
      const [instance, _created] = await db.CalendarEvent.upsert({
        recallId: event.id,
        recallData: event,
        platform: event.platform,
        updatedAt: new Date(),
        calendarId: calendarId,
      });
      eventsUpserted.push(event);
    }
  }

  console.log(
    `INFO: Synced (upsert: ${eventsUpserted.length}, delete: ${eventsDeleted.length}) calendar events for calendar(${calendarId})`
  );
  
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:sync_complete',message:'Sync events job completed',data:{calendarId,recallId,eventsUpserted:eventsUpserted.length,eventsDeleted:eventsDeleted.length,totalEventsFromRecall:events.length},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-job-1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion

  // update auto record status of the latest synced events
  await backgroundQueue.add("calendarevents.update_autorecord", {
    calendarId,
    recallEventIds: eventsUpserted.map((event) => event.id),
  });

  // delete bots for deleted events
  for (const event of eventsDeleted) {
    backgroundQueue.add("calendarevent.delete_bot", {
      recallEventId: event.id,
    });
  }

  // Check for Teams meetings and queue recording ingestion
  // Only check Microsoft Outlook events that have ended (to ensure recordings are available)
  const now = new Date();
  for (const event of eventsUpserted) {
    if (event.platform === "microsoft_outlook") {
      const meetingUrl = event.meeting_url || event.raw?.onlineMeeting?.joinUrl;
      const endTime = event.end_time ? new Date(event.end_time) : null;
      
      // Only process if it's a Teams meeting and has ended (recordings available after meeting ends)
      if (meetingUrl && meetingUrl.includes("teams.microsoft.com") && endTime && endTime < now) {
        // Find the local calendar event ID
        const localEvent = await db.CalendarEvent.findOne({
          where: { recallId: event.id, calendarId },
        });
        
        if (localEvent) {
          // Queue Teams recording ingestion (with delay to ensure recording is processed by Microsoft)
          // Microsoft typically processes recordings within a few minutes after meeting ends
          const delayMs = Math.max(0, now - endTime); // Delay if meeting just ended
          const minDelayMs = 5 * 60 * 1000; // At least 5 minutes after meeting ends
          const finalDelay = delayMs < minDelayMs ? minDelayMs - delayMs : 0;
          
          await backgroundQueue.add(
            "teams.recording.ingest",
            { calendarEventId: localEvent.id },
            { delay: finalDelay }
          );
          console.log(
            `INFO: Queued Teams recording ingestion for event ${event.id} (delay: ${Math.round(finalDelay / 1000)}s)`
          );
        }
      }
    }
  }
};

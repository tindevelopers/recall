import Recall from "../../services/recall/index.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

export default async (job) => {
  const { calendarId, recallId, lastUpdatedTimestamp } = job.data;
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:6',message:'Sync events job started',data:{calendarId,recallId,lastUpdatedTimestamp,jobId:job.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
  // #endregion
  console.log(
    `INFO: Sync events for calendar ${calendarId}(recall_id: ${recallId}) since ${lastUpdatedTimestamp}`
  );
  const events = await Recall.fetchCalendarEvents({
    id: recallId,
    lastUpdatedTimestamp,
  });
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:13',message:'Fetched events from Recall',data:{calendarId,recallId,eventCount:events.length,eventIds:events.map(e=>e.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
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
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:30',message:'Event upserted',data:{calendarId,recallEventId:event.id,localEventId:instance.id,wasCreated:_created,eventTitle:event.title,eventStart:event.start_time},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
      // #endregion
    }
  }

  console.log(
    `INFO: Synced (upsert: ${eventsUpserted.length}, delete: ${eventsDeleted.length}) calendar events for calendar(${calendarId})`
  );
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:40',message:'Sync complete, queueing autorecord update',data:{calendarId,eventsUpserted:eventsUpserted.length,eventsDeleted:eventsDeleted.length,recallEventIds:eventsUpserted.map(e=>e.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
  // #endregion

  // update auto record status of the latest synced events
  await backgroundQueue.add("calendarevents.update_autorecord", {
    calendarId,
    recallEventIds: eventsUpserted.map((event) => event.id),
  });
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/recall-calendar-sync-events.js:46',message:'Autorecord job queued',data:{calendarId,recallEventIds:eventsUpserted.map(e=>e.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
  // #endregion

  // delete bots for deleted events
  for (const event of eventsDeleted) {
    backgroundQueue.add("calendarevent.delete_bot", {
      recallEventId: event.id,
    });
  }
};

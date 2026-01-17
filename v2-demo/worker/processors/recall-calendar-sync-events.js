import Recall from "../../services/recall/index.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

export default async (job) => {
  const { calendarId, recallId, lastUpdatedTimestamp } = job.data;
  // #region agent log
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recall-calendar-sync-events.js:ENTRY',message:'Worker processing sync_events job',data:{calendarId,recallId,lastUpdatedTimestamp,jobId:job.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  console.log(
    `INFO: Sync events for calendar ${calendarId}(recall_id: ${recallId}) since ${lastUpdatedTimestamp}`
  );
  const events = await Recall.fetchCalendarEvents({
    id: recallId,
    lastUpdatedTimestamp,
  });
  // #region agent log
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recall-calendar-sync-events.js:EVENTS_FETCHED',message:'Fetched events from Recall',data:{calendarId,eventCount:events.length,eventIds:events.slice(0,5).map(e=>e.id)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
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

  // update auto record status of the latest synced events
  backgroundQueue.add("calendarevents.update_autorecord", {
    calendarId,
    recallEventIds: eventsUpserted.map((event) => event.id),
  });

  // delete bots for deleted events
  for (const event of eventsDeleted) {
    backgroundQueue.add("calendarevent.delete_bot", {
      recallEventId: event.id,
    });
  }
};

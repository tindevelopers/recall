import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { updateAutoRecordStatusForCalendarEvents } from "../../logic/autorecord.js";
import { telemetryEvent } from "../../utils/telemetry.js";

export default async (job) => {
  const { calendarId, recallEventIds } = job.data;
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-events-update-autorecord.js:7',message:'Autorecord job started',data:{calendarId,recallEventIds,recallEventIdsCount:recallEventIds.length,jobId:job.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
  // #endregion
  const [calendar, events] = await Promise.all([
    db.Calendar.findByPk(calendarId),
    db.CalendarEvent.findAll({
      where: {
        recallId: {
          [db.Sequelize.Op.in]: recallEventIds,
        },
      },
    }),
  ]);
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-events-update-autorecord.js:17',message:'Loaded calendar and events',data:{calendarId,calendarFound:!!calendar,eventsFound:events.length,eventIds:events.map(e=>e.id),recallEventIds},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
  // #endregion

  await updateAutoRecordStatusForCalendarEvents({ calendar, events });
  console.log(
    `INFO: Updated auto record status for ${events.length} events for calendar ${calendarId}`
  );
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-events-update-autorecord.js:22',message:'Auto record status updated, queueing bot scheduling',data:{calendarId,eventsCount:events.length,eventsWithAutoRecord:events.filter(e=>e.shouldRecordAutomatic).length,eventsWithManualRecord:events.filter(e=>e.shouldRecordManual).length,eventDetails:events.map(e=>({id:e.id,recallId:e.recallId,shouldRecordAutomatic:e.shouldRecordAutomatic,shouldRecordManual:e.shouldRecordManual,hasMeetingUrl:!!e.meetingUrl}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
  // #endregion

  // queue up bot schedule updates
  telemetryEvent(
    "Autorecord.queue_bot_scheduling",
    { calendarId, eventCount: events.length },
    { location: "worker/processors/calendar-events-update-autorecord.js:queue" }
  );
  for (const event of events) {
    try {
      await backgroundQueue.add("calendarevent.update_bot_schedule", {
        calendarId,
        recallEventId: event.recallId,
      });
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-events-update-autorecord.js:35',message:'Bot scheduling job queued',data:{calendarId,eventId:event.id,recallEventId:event.recallId,shouldRecordAutomatic:event.shouldRecordAutomatic,shouldRecordManual:event.shouldRecordManual,hasMeetingUrl:!!event.meetingUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
      // #endregion
    } catch (err) {
      console.error(`[AUTORECORD] Failed to queue bot scheduling for event ${event.id}:`, err);
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-events-update-autorecord.js:40',message:'Bot scheduling job queue failed',data:{calendarId,eventId:event.id,recallEventId:event.recallId,errorMessage:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'L'})}).catch(()=>{});
      // #endregion
      telemetryEvent(
        "Autorecord.queue_bot_scheduling_failed",
        { calendarId, recallEventId: event.recallId, errorMessage: err.message },
        { location: "worker/processors/calendar-events-update-autorecord.js:queue_failed" }
      );
    }
  }
};

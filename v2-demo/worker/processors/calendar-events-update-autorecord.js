import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { updateAutoRecordStatusForCalendarEvents } from "../../logic/autorecord.js";

export default async (job) => {
  const { calendarId, recallEventIds } = job.data;
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

  await updateAutoRecordStatusForCalendarEvents({ calendar, events });
  console.log(
    `INFO: Updated auto record status for ${events.length} events for calendar ${calendarId}`
  );

  // queue up bot schedule updates
  // #region agent log
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-events-update-autorecord.js:23',message:'Queueing bot scheduling jobs from autorecord',data:{calendarId,eventCount:events.length,recallEventIds:events.map(e=>e.recallId)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  events.forEach((event) => {
    backgroundQueue.add("calendarevent.update_bot_schedule", {
      calendarId,
      recallEventId: event.recallId,
    }).then(() => {
      // #region agent log
      fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-events-update-autorecord.js:28',message:'Bot scheduling job queued',data:{recallEventId:event.recallId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
    }).catch(err => {
      // #region agent log
      fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-events-update-autorecord.js:31',message:'Bot scheduling job queue failed',data:{recallEventId:event.recallId,errorMessage:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
    });
  });
};

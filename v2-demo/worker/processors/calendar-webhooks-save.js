import db from "../../db.js";

export default async (job) => {
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-webhooks-save.js:4',message:'Webhook save job started',data:{calendarId:job.data.calendarId,event:job.data.event,jobId:job.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'I'})}).catch(()=>{});
  // #endregion
  const { calendarId, event, payload } = job.data;
  try {
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-webhooks-save.js:7',message:'Creating webhook record in database',data:{calendarId,event,hasPayload:!!payload,payloadKeys:payload?Object.keys(payload):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    const calendarWebhook = await db.CalendarWebhook.create({
      calendarId,
      event,
      payload,
      receivedAt: new Date(),
    });
    console.log(
      `INFO: Recorded calendar webhook: ${JSON.stringify(calendarWebhook)}`
    );
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-webhooks-save.js:14',message:'Webhook saved successfully to PostgreSQL',data:{webhookId:calendarWebhook.id,calendarId,event,receivedAt:calendarWebhook.receivedAt},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
  } catch (error) {
    console.error(`[WEBHOOK-SAVE] Failed to save webhook:`, error);
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-webhooks-save.js:17',message:'Webhook save failed',data:{calendarId,event,error:error.message,errorStack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    throw error; // Re-throw to mark job as failed
  }
};

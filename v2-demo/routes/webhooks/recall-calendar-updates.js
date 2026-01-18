import { backgroundQueue } from "../../queue.js";
import db from "../../db.js";

export default async (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:4',message:'Webhook handler entry',data:{method:req.method,path:req.path,hasBody:!!req.body,bodyType:typeof req.body,bodyKeys:req.body?Object.keys(req.body):[],query:req.query,headers:Object.keys(req.headers)},timestamp:Date.now(),sessionId:'debug-session',runId:'run6',hypothesisId:'K'})}).catch(()=>{});
  // #endregion
  
  // Handle GET requests for webhook verification (some webhook systems verify endpoints with GET)
  if (req.method === 'GET') {
    console.log(`[WEBHOOK] Received GET request for verification: ${req.path}`);
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:10',message:'Webhook verification GET request',data:{method:req.method,path:req.path,query:req.query,userAgent:req.headers['user-agent']},timestamp:Date.now(),sessionId:'debug-session',runId:'run6',hypothesisId:'K'})}).catch(()=>{});
    // #endregion
    return res.status(200).json({ 
      status: 'ok', 
      message: 'Webhook endpoint is active',
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    // Log incoming webhook request for debugging
    console.log(
      `[WEBHOOK] Received request: method=${req.method}, path=${req.path}, headers=${JSON.stringify({
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
      })}`
    );

    // Validate request body structure
    if (!req.body || typeof req.body !== 'object') {
      console.error(`[WEBHOOK] Invalid request body: ${JSON.stringify(req.body)}`);
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:15',message:'Invalid request body',data:{body:req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { event, data: payload } = req.body;
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:22',message:'Parsed webhook body',data:{event,hasPayload:!!payload,payloadKeys:payload?Object.keys(payload):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
    // #endregion

    if (!event) {
      console.error(`[WEBHOOK] Missing 'event' field in request body`);
      return res.status(400).json({ error: 'Missing required field: event' });
    }

    if (!payload || typeof payload !== 'object') {
      console.error(`[WEBHOOK] Missing or invalid 'data' field in request body`);
      return res.status(400).json({ error: 'Missing required field: data' });
    }

    const { calendar_id: recallId } = payload;

    if (!recallId) {
      console.error(`[WEBHOOK] Missing 'calendar_id' in payload: ${JSON.stringify(payload)}`);
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:32',message:'Webhook missing calendar_id',data:{event,payloadKeys:Object.keys(payload||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      return res.status(400).json({ error: 'Missing required field: data.calendar_id' });
    }

    console.log(
      `[WEBHOOK] Processing "${event}" calendar webhook from Recall for calendar_id=${recallId}`
    );
    console.log(`[WEBHOOK] Full payload: ${JSON.stringify(payload, null, 2)}`);
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:40',message:'Webhook received, looking up calendar',data:{event,recallId,payloadKeys:Object.keys(payload||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
    // #endregion

    // verify calendar exists on our end
    const calendar = await db.Calendar.findOne({ where: { recallId } });
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:45',message:'Calendar lookup result',data:{recallId,calendarFound:!!calendar,calendarId:calendar?.id,calendarEmail:calendar?.email},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
    // #endregion
    if (!calendar) {
      console.warn(
        `[WEBHOOK] Could not find calendar with recall_id: ${recallId}. Ignoring webhook.`
      );
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:48',message:'Calendar not found, webhook ignored',data:{recallId,event},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      // Still return 200 to prevent Recall from retrying
      return res.sendStatus(200);
    }

    console.log(`[WEBHOOK] Found calendar: id=${calendar.id}, platform=${calendar.platform}, email=${calendar.email}`);

    // Save webhook synchronously to ensure it's recorded even if worker isn't running
    try {
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:56',message:'Saving webhook synchronously to PostgreSQL',data:{calendarId:calendar.id,calendarIdType:typeof calendar.id,event,recallId,hasPayload:!!payload,payloadType:typeof payload},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      const calendarWebhook = await db.CalendarWebhook.create({
        calendarId: calendar.id,
        event,
        payload,
        receivedAt: new Date(),
      });
      console.log(`[WEBHOOK] Saved webhook to database: id=${calendarWebhook.id}, event=${event}, calendarId=${calendar.id}`);
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:62',message:'Webhook saved successfully to PostgreSQL',data:{webhookId:calendarWebhook.id,calendarId:calendarWebhook.calendarId,calendarIdType:typeof calendarWebhook.calendarId,event,receivedAt:calendarWebhook.receivedAt},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      // Verify it was saved by reloading
      await calendarWebhook.reload();
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:66',message:'Webhook reloaded from database to verify',data:{webhookId:calendarWebhook.id,calendarId:calendarWebhook.calendarId,event,receivedAt:calendarWebhook.receivedAt},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
    } catch (saveError) {
      console.error(`[WEBHOOK] Failed to save webhook directly:`, saveError);
      console.error(`[WEBHOOK] Save error stack:`, saveError.stack);
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/webhooks/recall-calendar-updates.js:70',message:'Webhook direct save failed, trying queue',data:{calendarId:calendar.id,event,error:saveError.message,errorStack:saveError.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      // Fallback: try to queue the job (worker might be running)
      try {
        await backgroundQueue.add("calendarwebhooks.save", {
          calendarId: calendar.id,
          event,
          payload,
        });
        console.log(`[WEBHOOK] Queued webhook save job as fallback`);
      } catch (queueError) {
        console.error(`[WEBHOOK] Failed to queue webhook save job:`, queueError);
      }
    }

    // queue jobs to process the webhook
    if (event === "calendar.update") {
      try {
        // Update calendar metadata
        await backgroundQueue.add("recall.calendar.update", {
          calendarId: calendar.id,
          recallId: calendar.recallId,
        });
        console.log(`[WEBHOOK] Queued job to update calendar ${calendar.id}`);
        
        // Also sync events when calendar is updated (new events may have been added)
        const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await backgroundQueue.add("recall.calendar.sync_events", {
          calendarId: calendar.id,
          recallId: calendar.recallId,
          lastUpdatedTimestamp: last24Hours,
        });
        console.log(`[WEBHOOK] Queued event sync job for calendar ${calendar.id} (triggered by calendar.update)`);
      } catch (queueError) {
        console.error(`[WEBHOOK] Failed to queue calendar update job:`, queueError);
      }
    } else if (event === "calendar.sync_events") {
      try {
        await backgroundQueue.add("recall.calendar.sync_events", {
          calendarId: calendar.id,
          recallId: calendar.recallId,
          lastUpdatedTimestamp: payload.last_updated_ts,
        });
        console.log(`[WEBHOOK] Queued job to sync events for calendar ${calendar.id}`);
      } catch (queueError) {
        console.error(`[WEBHOOK] Failed to queue calendar sync events job:`, queueError);
      }
    } else if (event === "calendar.event.created" || event === "calendar.event.updated" || event === "calendar.event") {
      // Handle individual calendar event webhooks - trigger a sync to get the latest events
      try {
        // Sync events from the last 24 hours to catch any new events
        const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await backgroundQueue.add("recall.calendar.sync_events", {
          calendarId: calendar.id,
          recallId: calendar.recallId,
          lastUpdatedTimestamp: last24Hours,
        });
        console.log(`[WEBHOOK] Queued job to sync events for calendar ${calendar.id} (triggered by ${event})`);
      } catch (queueError) {
        console.error(`[WEBHOOK] Failed to queue calendar sync events job:`, queueError);
      }
    } else {
      // For unknown event types, trigger a sync anyway to ensure we don't miss new events
      // This is a safety net - if Recall sends a new event type we don't recognize,
      // we'll still sync events to catch any changes
      console.log(`[WEBHOOK] Unknown event type: ${event}. Triggering event sync as safety measure.`);
      try {
        const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await backgroundQueue.add("recall.calendar.sync_events", {
          calendarId: calendar.id,
          recallId: calendar.recallId,
          lastUpdatedTimestamp: last24Hours,
        });
        console.log(`[WEBHOOK] Queued safety sync job for calendar ${calendar.id}`);
      } catch (queueError) {
        console.error(`[WEBHOOK] Failed to queue safety sync job:`, queueError);
      }
    }

    console.log(`[WEBHOOK] Successfully processed webhook for event: ${event}`);
    return res.sendStatus(200);
  } catch (error) {
    console.error(`[WEBHOOK] Error processing webhook:`, error);
    console.error(`[WEBHOOK] Stack trace:`, error.stack);
    // Return 200 to prevent Recall from retrying, but log the error
    return res.status(200).json({ 
      error: 'Internal server error processing webhook',
      message: error.message 
    });
  }
};

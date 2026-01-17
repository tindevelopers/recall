import { backgroundQueue } from "../../queue.js";
import db from "../../db.js";

export default async (req, res) => {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recall-calendar-updates.js:ENTRY',message:'Webhook endpoint hit',data:{method:req.method,path:req.path,contentType:req.headers['content-type'],userAgent:req.headers['user-agent'],bodyKeys:req.body?Object.keys(req.body):null,event:req.body?.event,calendarId:req.body?.data?.calendar_id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
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
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { event, data: payload } = req.body;

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
      return res.status(400).json({ error: 'Missing required field: data.calendar_id' });
    }

    console.log(
      `[WEBHOOK] Processing "${event}" calendar webhook from Recall for calendar_id=${recallId}`
    );
    console.log(`[WEBHOOK] Full payload: ${JSON.stringify(payload, null, 2)}`);

    // verify calendar exists on our end
    const calendar = await db.Calendar.findOne({ where: { recallId } });
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recall-calendar-updates.js:CALENDAR_LOOKUP',message:'Calendar lookup result',data:{recallId,found:!!calendar,calendarId:calendar?.id,email:calendar?.email},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    if (!calendar) {
      console.warn(
        `[WEBHOOK] Could not find calendar with recall_id: ${recallId}. Ignoring webhook.`
      );
      // Still return 200 to prevent Recall from retrying
      return res.sendStatus(200);
    }

    console.log(`[WEBHOOK] Found calendar: id=${calendar.id}, platform=${calendar.platform}, email=${calendar.email}`);

    // queue job to save the webhook for bookkeeping
    try {
      await backgroundQueue.add("calendarwebhooks.save", {
        calendarId: calendar.id,
        event,
        payload,
      });
      console.log(`[WEBHOOK] Queued job to save webhook for calendar ${calendar.id}`);
    } catch (queueError) {
      console.error(`[WEBHOOK] Failed to queue webhook save job:`, queueError);
      // Continue processing even if save job fails
    }

    // queue jobs to process the webhook
    if (event === "calendar.update") {
      try {
        await backgroundQueue.add("recall.calendar.update", {
          calendarId: calendar.id,
          recallId: calendar.recallId,
        });
        console.log(`[WEBHOOK] Queued job to update calendar ${calendar.id}`);
      } catch (queueError) {
        console.error(`[WEBHOOK] Failed to queue calendar update job:`, queueError);
      }
    } else if (event === "calendar.sync_events") {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recall-calendar-updates.js:QUEUE_SYNC',message:'About to queue sync_events job',data:{calendarId:calendar.id,recallId:calendar.recallId,lastUpdatedTs:payload.last_updated_ts},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        await backgroundQueue.add("recall.calendar.sync_events", {
          calendarId: calendar.id,
          recallId: calendar.recallId,
          lastUpdatedTimestamp: payload.last_updated_ts,
        });
        // #region agent log
        fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recall-calendar-updates.js:QUEUE_SUCCESS',message:'Successfully queued sync_events job',data:{calendarId:calendar.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        console.log(`[WEBHOOK] Queued job to sync events for calendar ${calendar.id}`);
      } catch (queueError) {
        // #region agent log
        fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recall-calendar-updates.js:QUEUE_FAIL',message:'Failed to queue sync_events job',data:{error:queueError.message},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        console.error(`[WEBHOOK] Failed to queue calendar sync events job:`, queueError);
      }
    } else {
      console.log(`[WEBHOOK] Unknown event type: ${event}. Webhook saved but no processing job queued.`);
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

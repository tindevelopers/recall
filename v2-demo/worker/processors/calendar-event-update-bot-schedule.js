import Recall from "../../services/recall/index.js";
import db from "../../db.js";
import { buildBotConfig } from "../../logic/bot-config.js";
import { telemetryEvent } from "../../utils/telemetry.js";

// add or remove bot for a calendar event based on its record status
export default async (job) => {
  const { recallEventId } = job.data;
  await telemetryEvent(
    "BotScheduling.job_started",
    { recallEventId },
    { location: "worker/processors/calendar-event-update-bot-schedule.js:job_start" }
  );
  
  const event = await db.CalendarEvent.findOne({
    where: { recallId: recallEventId },
  });
  
  await telemetryEvent(
    "BotScheduling.event_loaded",
    {
      recallEventId,
      hasEvent: !!event,
      eventId: event?.id,
      shouldRecordAutomatic: event?.shouldRecordAutomatic,
      shouldRecordManual: event?.shouldRecordManual,
      hasMeetingUrl: !!event?.meetingUrl,
    },
    { location: "worker/processors/calendar-event-update-bot-schedule.js:event_loaded" }
  );

  let updatedEventFromRecall = null;
  if (
    (event.shouldRecordAutomatic || event.shouldRecordManual) &&
    event.meetingUrl
  ) {
    console.log(`INFO: Schedule bot for event ${event.id}`);
    
    // Get calendar to check bot settings
    const calendar = await db.Calendar.findByPk(event.calendarId);

    // Determine public URL for webhooks (try multiple sources)
    let publicUrl = process.env.PUBLIC_URL;
    if (!publicUrl && process.env.RAILWAY_PUBLIC_DOMAIN) {
      publicUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }
    if (!publicUrl && process.env.RAILWAY_STATIC_URL) {
      publicUrl = process.env.RAILWAY_STATIC_URL;
    }
    
    // Determine effective transcription mode (event override takes precedence)
    const effectiveTranscriptionMode = event.transcriptionMode || calendar?.transcriptionMode || "realtime";
    console.log(`[BOT_CONFIG] Calendar settings: enableTranscription=${calendar?.enableTranscription}, transcriptionMode=${calendar?.transcriptionMode}`);
    console.log(`[BOT_CONFIG] Event override: transcriptionMode=${event.transcriptionMode}, effective=${effectiveTranscriptionMode}`);
    console.log(`[BOT_CONFIG] Public URL for webhooks: ${publicUrl || 'NOT SET - realtime_endpoints will be empty!'}`);

    // Build bot config from calendar settings + event overrides (shared logic)
    const botConfig = buildBotConfig({
      calendar,
      event,  // Pass event for per-meeting transcription override
      publicUrl,
    });
    
    // Calculate join_at time (must be at least 10 minutes before meeting start for scheduled bots)
    // Recall API expects join_at as ISO8601 datetime string
    const joinBeforeStartMinutes = calendar?.joinBeforeStartMinutes || 1;
    const joinAtTime = new Date(event.startTime);
    joinAtTime.setMinutes(joinAtTime.getMinutes() - Math.max(joinBeforeStartMinutes, 10));
    
    // Add join_at to bot config if we have a valid start time
    if (event.startTime && event.startTime > new Date()) {
      botConfig.join_at = joinAtTime.toISOString();
    }
    
    // Use a stable deduplication key based on the Recall event ID
    // This ensures that when a meeting is updated (e.g., time changes), 
    // the existing bot is updated rather than creating a new one
    const deduplicationKey = `recall-event-${event.recallId}`;
    
    // Log only a compact summary (Railway log rate limiting can drop important messages)
    console.log(
      `[BOT_CONFIG] Scheduling summary: eventId=${event.id} recallEventId=${event.recallId} start=${event.startTime.toISOString()} join_at=${botConfig.join_at || "not_set"} hasMeetingUrl=${!!event.meetingUrl} deduplicationKey=${deduplicationKey}`
    );
    
    // Validate event is in the future before scheduling
    if (event.startTime <= new Date()) {
      console.warn(
        `[BOT_CONFIG] Skipping (past/ongoing): eventId=${event.id} recallEventId=${event.recallId} start=${event.startTime.toISOString()}`
      );
      return;
    }
    
    // add a bot to record the event. Recall will handle the case where the bot already exists.
    try {
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:66',message:'Calling Recall API to add bot',data:{recallEventId:event.recallId,eventId:event.id,deduplicationKey,hasJoinAt:!!botConfig.join_at,joinAt:botConfig.join_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      
      updatedEventFromRecall = await Recall.addBotToCalendarEvent({
        id: event.recallId,
        deduplicationKey,
        botConfig,
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:72',message:'Recall API call succeeded',data:{eventId:event.id,hasResponse:!!updatedEventFromRecall,responseBots:updatedEventFromRecall?.bots?.length||0,botIds:updatedEventFromRecall?.bots?.map(b=>b.id)||[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
    } catch (error) {
      console.error(`[BOT_CONFIG] Failed to schedule bot for event ${event.id}:`, error.message);
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:73',message:'Recall API call failed',data:{eventId:event.id,errorMessage:error.message,errorStatus:error.res?.status,hasErrorBody:!!error.res},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      // Log the full error for debugging
      if (error.res) {
        const errorBody = await error.res.text().catch(() => 'Unable to read error body');
        console.error(`[BOT_CONFIG] Recall API error response:`, errorBody);
      }
      throw error; // Re-throw to mark job as failed
    }
    
    console.log(`[BOT_CONFIG] Bot scheduled successfully for event ${event.id}`);
  } else {
    console.log(`INFO: Delete bot for event ${event.id}`);
    // delete the bot for the event. Recall will handle the case where the bot does not exist.
    updatedEventFromRecall = await Recall.removeBotFromCalendarEvent({
      id: event.recallId,
    });
  }

  // update event data returned from Recall
  if (updatedEventFromRecall) {
    event.recallData = updatedEventFromRecall;
    await event.save();
  }
};

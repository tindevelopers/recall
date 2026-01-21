import Recall from "../../services/recall/index.js";
import db from "../../db.js";
import { buildBotConfig } from "../../logic/bot-config.js";
import { telemetryEvent } from "../../utils/telemetry.js";
import { checkForSharedBot, getSharedDeduplicationKey } from "../../utils/shared-bot-scheduling.js";

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

  // If event not found, log and return (event may not be synced yet)
  if (!event) {
    console.warn(`[BOT_CONFIG] Event not found for recallEventId ${recallEventId} - event may not be synced yet`);
    return;
  }

  let updatedEventFromRecall = null;
  if (
    (event.shouldRecordAutomatic || event.shouldRecordManual) &&
    event.meetingUrl
  ) {
    console.log(`INFO: Schedule bot for event ${event.id}`);
    
    // Get calendar to check bot settings (with user for shared bot detection)
    const calendar = await db.Calendar.findByPk(event.calendarId, {
      include: [{ model: db.User }],
    });

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
    
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:bot_config_built',message:'Bot config built before scheduling',data:{eventId:event.id,recallEventId:event.recallId,hasBotConfig:!!botConfig,hasRecordingConfig:!!botConfig.recording_config,hasStatusCallback:!!botConfig.status_callback_url,publicUrl:publicUrl||'not-set'},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // Calculate join_at time (must be at least 10 minutes before meeting start for scheduled bots)
    // Recall API expects join_at as ISO8601 datetime string
    const joinBeforeStartMinutes = calendar?.joinBeforeStartMinutes || 1;
    const joinAtTime = new Date(event.startTime);
    joinAtTime.setMinutes(joinAtTime.getMinutes() - Math.max(joinBeforeStartMinutes, 10));
    
    // Add join_at to bot config if we have a valid start time
    if (event.startTime && event.startTime > new Date()) {
      botConfig.join_at = joinAtTime.toISOString();
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:join_at_calculated',message:'Join_at time calculated',data:{eventId:event.id,startTime:event.startTime.toISOString(),joinAtTime:joinAtTime.toISOString(),joinBeforeStartMinutes:joinBeforeStartMinutes,hasJoinAt:!!botConfig.join_at,joinAtValue:botConfig.join_at},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // Check for shared bot from same company
    const userEmail = calendar?.User?.email;
    
    let deduplicationKey = `recall-event-${event.recallId}`;
    let sharedBotInfo = null;
    
    if (event.meetingUrl && userEmail) {
      // Check if another user from the same company already has a bot scheduled
      sharedBotInfo = await checkForSharedBot(event.meetingUrl, calendar.userId, userEmail);
      
      if (sharedBotInfo.hasSharedBot) {
        console.log(
          `[SHARED-BOT] Found existing bot from same company: eventId=${event.id} sharedEventId=${sharedBotInfo.sharedEventId} sharedBotId=${sharedBotInfo.sharedBotId} sharedUser=${sharedBotInfo.sharedUserEmail}`
        );
        
        // Use shared deduplication key so Recall API uses the same bot
        const sharedKey = getSharedDeduplicationKey(event.meetingUrl, userEmail);
        if (sharedKey) {
          deduplicationKey = sharedKey;
          console.log(`[SHARED-BOT] Using shared deduplication key: ${deduplicationKey}`);
        }
      } else {
        // Try to use shared key anyway for future coordination
        const sharedKey = getSharedDeduplicationKey(event.meetingUrl, userEmail);
        if (sharedKey) {
          deduplicationKey = sharedKey;
          console.log(`[SHARED-BOT] Using shared deduplication key for company coordination: ${deduplicationKey}`);
        }
      }
    }
    
    // Log only a compact summary (Railway log rate limiting can drop important messages)
    console.log(
      `[BOT_CONFIG] Scheduling summary: eventId=${event.id} recallEventId=${event.recallId} start=${event.startTime.toISOString()} join_at=${botConfig.join_at || "not_set"} hasMeetingUrl=${!!event.meetingUrl} deduplicationKey=${deduplicationKey}${sharedBotInfo?.hasSharedBot ? ' [SHARED]' : ''}`
    );
    
    // Validate event is in the future before scheduling
    if (event.startTime <= new Date()) {
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:skipped_past_event',message:'Skipping past/ongoing event',data:{eventId:event.id,recallEventId:event.recallId,startTime:event.startTime.toISOString(),now:new Date().toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      console.warn(
        `[BOT_CONFIG] Skipping (past/ongoing): eventId=${event.id} recallEventId=${event.recallId} start=${event.startTime.toISOString()}`
      );
      return;
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:before_api_call',message:'Before calling Recall API to schedule bot',data:{eventId:event.id,recallEventId:event.recallId,deduplicationKey:deduplicationKey,botConfigKeys:Object.keys(botConfig),hasJoinAt:!!botConfig.join_at},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // add a bot to record the event. Recall will handle the case where the bot already exists.
    try {
      
      updatedEventFromRecall = await Recall.addBotToCalendarEvent({
        id: event.recallId,
        deduplicationKey,
        botConfig,
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:api_call_success',message:'Recall API call succeeded',data:{eventId:event.id,recallEventId:event.recallId,hasResult:!!updatedEventFromRecall,resultKeys:updatedEventFromRecall?Object.keys(updatedEventFromRecall):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/calendar-event-update-bot-schedule.js:api_call_failed',message:'Recall API call failed',data:{eventId:event.id,recallEventId:event.recallId,errorMessage:error.message,errorStatus:error.res?.status,hasErrorBody:!!error.body,errorBodyPreview:error.body?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      console.error(`[BOT_CONFIG] Failed to schedule bot for event ${event.id}:`, error.message);
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

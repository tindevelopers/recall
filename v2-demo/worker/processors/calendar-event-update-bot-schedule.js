import Recall from "../../services/recall/index.js";
import db from "../../db.js";
import { buildBotConfig } from "../../logic/bot-config.js";

const DEBUG_ENDPOINT =
  "http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc";
const logDebug = (payload) => {
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
};

// add or remove bot for a calendar event based on its record status
export default async (job) => {
  const { recallEventId } = job.data;
  const event = await db.CalendarEvent.findOne({
    where: { recallId: recallEventId },
  });

  let updatedEventFromRecall = null;
  if (
    (event.shouldRecordAutomatic || event.shouldRecordManual) &&
    event.meetingUrl
  ) {
    console.log(`INFO: Schedule bot for event ${event.id}`);
    
    // Get calendar to check bot settings
    const calendar = await db.Calendar.findByPk(event.calendarId);
    
    // #region agent log
    logDebug({
      sessionId: "debug-session",
      runId: "pre-fix",
      hypothesisId: "H1",
      location: "calendar-event-update-bot-schedule.js:23",
      message: "Scheduling bot entry",
      data: {
        eventId: event.id,
        recallEventId: event.recallId,
        shouldRecord: event.shouldRecordAutomatic || event.shouldRecordManual,
        meetingUrl: event.meetingUrl,
      },
      timestamp: Date.now(),
    });
    // #endregion

    // Determine public URL for webhooks (try multiple sources)
    let publicUrl = process.env.PUBLIC_URL;
    if (!publicUrl && process.env.RAILWAY_PUBLIC_DOMAIN) {
      publicUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }
    if (!publicUrl && process.env.RAILWAY_STATIC_URL) {
      publicUrl = process.env.RAILWAY_STATIC_URL;
    }
    
    console.log(`[BOT_CONFIG] Calendar settings: enableTranscription=${calendar?.enableTranscription}, transcriptionMode=${calendar?.transcriptionMode}`);
    console.log(`[BOT_CONFIG] Public URL for webhooks: ${publicUrl || 'NOT SET - realtime_endpoints will be empty!'}`);

    // Build bot config from calendar settings (shared logic)
    const botConfig = buildBotConfig({
      calendar,
      publicUrl,
    });

    // #region agent log
    logDebug({
      sessionId: "debug-session",
      runId: "post-fix",
      hypothesisId: "H2",
      location: "calendar-event-update-bot-schedule.js:buildBotConfig",
      message: "Bot config built (includes transcript/realtime_endpoints when enabled)",
      data: {
        hasRecordingConfig: !!botConfig.recording_config,
        hasTranscript: !!botConfig.recording_config?.transcript,
        hasRealtimeEndpoints: !!botConfig.recording_config?.realtime_endpoints,
      },
      timestamp: Date.now(),
    });
    // #endregion
    
    // Log the bot config being sent to Recall API for debugging
    console.log(`[BOT_CONFIG] Sending bot config for event ${event.id}:`, JSON.stringify(botConfig, null, 2));
    
    // add a bot to record the event. Recall will handle the case where the bot already exists.
    updatedEventFromRecall = await Recall.addBotToCalendarEvent({
      id: event.recallId,
      deduplicationKey: `${event.startTime.toISOString()}-${event.meetingUrl}`,
      botConfig,
    });
    
    console.log(`[BOT_CONFIG] Bot scheduled successfully for event ${event.id}`);
    // #region agent log
    logDebug({
      sessionId: "debug-session",
      runId: "pre-fix",
      hypothesisId: "H3",
      location: "calendar-event-update-bot-schedule.js:74",
      message: "Bot scheduled response",
      data: {
        recallEventId: event.recallId,
        responseSummary: !!updatedEventFromRecall,
      },
      timestamp: Date.now(),
    });
    // #endregion
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

import Recall from "../../services/recall/index.js";
import db from "../../db.js";

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

    // Build bot config from calendar settings
    const botConfig = {};
    
    // Bot appearance
    if (calendar) {
      if (calendar.botName) {
        botConfig.bot_name = calendar.botName;
      }
      if (calendar.botAvatarUrl) {
        botConfig.bot_image = calendar.botAvatarUrl;
      }
    }
    
    // Recording config - Recall.ai expects recording_config object
    botConfig.recording_config = {};
    
    // Recording settings
    if (calendar) {
      botConfig.recording_config.video = calendar.recordVideo !== false;
      botConfig.recording_config.audio = calendar.recordAudio !== false;
    }
    
    // Transcription settings - Must be nested under recording_config.transcript
    // Only enable if calendar.enableTranscription is true
    // Users can disable transcription from the Bot Settings page
    if (calendar && calendar.enableTranscription !== false) {
      botConfig.recording_config.transcript = {
        provider: calendar.useRetellTranscription ? "retell" : "default",
      };
      
      // Add mode if specified (realtime vs async)
      if (calendar.transcriptionMode) {
        botConfig.recording_config.transcript.mode = calendar.transcriptionMode;
      }
      
      // Add language if specified
      if (calendar.transcriptionLanguage && calendar.transcriptionLanguage !== "auto") {
        botConfig.recording_config.transcript.language = calendar.transcriptionLanguage;
      }
      
      // #region agent log
      logDebug({
        sessionId: "debug-session",
        runId: "post-fix",
        hypothesisId: "H2",
        location: "calendar-event-update-bot-schedule.js:71",
        message: "Transcription payload included in recording_config",
        data: {
          provider: botConfig.recording_config.transcript.provider,
          mode: botConfig.recording_config.transcript.mode || null,
          language: botConfig.recording_config.transcript.language || null,
          hasTranscript: !!botConfig.recording_config.transcript,
        },
        timestamp: Date.now(),
      });
      // #endregion
    }
    // If enableTranscription is false, transcript config is omitted from recording_config
    
    // Bot behavior settings
    if (calendar) {
      if (calendar.joinBeforeStartMinutes > 0) {
        botConfig.join_at = {
          minutes_before_start: calendar.joinBeforeStartMinutes,
        };
      }
      if (calendar.autoLeaveIfAlone) {
        botConfig.automatic_leave = {
          waiting_room_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
          noone_joined_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
        };
      }
    }
    
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

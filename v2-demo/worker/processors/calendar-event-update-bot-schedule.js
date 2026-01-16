import Recall from "../../services/recall/index.js";
import db from "../../db.js";

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
    
    // Transcription settings - ALWAYS enable transcription when bot joins
    // This ensures transcription starts immediately when the bot joins the meeting
    if (calendar) {
      botConfig.transcription = {
        provider: calendar.useRetellTranscription ? "retell" : "default",
        mode: calendar.transcriptionMode || "realtime", // "realtime" or "async"
      };
      if (calendar.transcriptionLanguage && calendar.transcriptionLanguage !== "auto") {
        botConfig.transcription.language = calendar.transcriptionLanguage;
      }
    } else {
      // Default transcription config if calendar not found (shouldn't happen, but safety)
      botConfig.transcription = {
        provider: "default",
        mode: "realtime",
      };
    }
    
    // Recording settings
    if (calendar) {
      botConfig.recording = {
        video: calendar.recordVideo !== false,
        audio: calendar.recordAudio !== false,
      };
    }
    
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

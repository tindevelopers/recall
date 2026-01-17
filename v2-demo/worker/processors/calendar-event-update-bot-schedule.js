import Recall from "../../services/recall/index.js";
import db from "../../db.js";
import { buildBotConfig } from "../../logic/bot-config.js";

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
    
    // Calculate join_at time (must be at least 10 minutes before meeting start for scheduled bots)
    // Recall API expects join_at as ISO8601 datetime string
    const joinBeforeStartMinutes = calendar?.joinBeforeStartMinutes || 1;
    const joinAtTime = new Date(event.startTime);
    joinAtTime.setMinutes(joinAtTime.getMinutes() - Math.max(joinBeforeStartMinutes, 10));
    
    // Add join_at to bot config if we have a valid start time
    if (event.startTime && event.startTime > new Date()) {
      botConfig.join_at = joinAtTime.toISOString();
    }
    
    // Log the bot config being sent to Recall API for debugging
    console.log(`[BOT_CONFIG] Sending bot config for event ${event.id}:`, JSON.stringify(botConfig, null, 2));
    console.log(`[BOT_CONFIG] Event start: ${event.startTime.toISOString()}, join_at: ${botConfig.join_at || 'not set'}`);
    
    // Validate event is in the future before scheduling
    if (event.startTime <= new Date()) {
      console.warn(`[BOT_CONFIG] Event ${event.id} has already started or ended. Skipping bot scheduling.`);
      return;
    }
    
    // add a bot to record the event. Recall will handle the case where the bot already exists.
    try {
      updatedEventFromRecall = await Recall.addBotToCalendarEvent({
        id: event.recallId,
        deduplicationKey: `${event.startTime.toISOString()}-${event.meetingUrl}`,
        botConfig,
      });
    } catch (error) {
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

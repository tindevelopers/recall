/**
 * Debug endpoint to inspect the computed bot_config for a calendar event.
 *
 * GET /api/debug-bot-config?calendarId=<id>&eventId=<id>
 *
 * Returns the exact bot_config that would be sent to Recall.ai when scheduling
 * a bot for the specified calendar event. Useful for verifying transcription
 * settings are correct.
 *
 * Optional: POST /api/debug-bot-config?calendarId=<id>&eventId=<id>&enqueue=true
 * to actually enqueue the bot scheduling job.
 */

import db from "../../db.js";
import { buildBotConfig } from "../../logic/bot-config.js";
import { backgroundQueue } from "../../queue.js";

export default async (req, res) => {
  const { calendarId, eventId, enqueue } = { ...req.query, ...req.body };

  if (!calendarId && !eventId) {
    return res.status(400).json({
      error: "Missing calendarId or eventId query parameter",
      usage: "GET /api/debug-bot-config?calendarId=<uuid> or ?eventId=<uuid>",
    });
  }

  try {
    let calendar = null;
    let calendarEvent = null;

    if (eventId) {
      calendarEvent = await db.CalendarEvent.findByPk(eventId, {
        include: [{ model: db.Calendar }],
      });
      if (!calendarEvent) {
        return res.status(404).json({ error: `CalendarEvent ${eventId} not found` });
      }
      calendar = calendarEvent.Calendar;
    } else if (calendarId) {
      calendar = await db.Calendar.findByPk(calendarId);
      if (!calendar) {
        return res.status(404).json({ error: `Calendar ${calendarId} not found` });
      }
    }

    // Build the bot config using the same logic as the worker
    let publicUrl = process.env.PUBLIC_URL;
    if (!publicUrl && process.env.RAILWAY_PUBLIC_DOMAIN) {
      publicUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }
    if (!publicUrl && process.env.RAILWAY_STATIC_URL) {
      publicUrl = process.env.RAILWAY_STATIC_URL;
    }
    if (!publicUrl) {
      publicUrl = "http://localhost:3000";
    }

    const botConfig = buildBotConfig({ calendar, publicUrl });

    const response = {
      // Environment diagnostics
      environment: {
        PUBLIC_URL: process.env.PUBLIC_URL || "(not set)",
        RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN || "(not set)",
        RAILWAY_STATIC_URL: process.env.RAILWAY_STATIC_URL || "(not set)",
        resolvedPublicUrl: publicUrl,
      },
      calendar: calendar
        ? {
            id: calendar.id,
            provider: calendar.provider,
            enableTranscription: calendar.enableTranscription,
            transcriptionMode: calendar.transcriptionMode,
            transcriptionLanguage: calendar.transcriptionLanguage,
            useRetellTranscription: calendar.useRetellTranscription,
            recordVideo: calendar.recordVideo,
            recordAudio: calendar.recordAudio,
            botName: calendar.botName,
          }
        : null,
      calendarEvent: calendarEvent
        ? {
            id: calendarEvent.id,
            recallId: calendarEvent.recallId,
            title: calendarEvent.title,
            startTime: calendarEvent.startTime,
            shouldRecord: calendarEvent.shouldRecord,
          }
        : null,
      publicUrl,
      botConfig,
      // Show the JSON that would be sent to Recall API
      recallApiPayload: {
        deduplication_key: calendarEvent
          ? `${calendarEvent.id}-${Date.now()}`
          : "debug-key",
        bot_config: botConfig,
      },
      // Warnings
      warnings: [
        !process.env.PUBLIC_URL && !process.env.RAILWAY_PUBLIC_DOMAIN
          ? "⚠️ PUBLIC_URL not set - realtime_endpoints may be empty. Set PUBLIC_URL env var to your app's public URL."
          : null,
        calendar && calendar.enableTranscription === false
          ? "⚠️ Transcription is DISABLED for this calendar. Enable it in Bot Settings."
          : null,
        !botConfig.recording_config?.transcript
          ? "⚠️ No transcript config in bot_config - transcription will NOT be enabled."
          : null,
        !botConfig.recording_config?.realtime_endpoints?.length
          ? "⚠️ No realtime_endpoints - you won't receive streaming transcript events."
          : null,
      ].filter(Boolean),
    };

    // Optionally enqueue the bot scheduling job
    if (enqueue === "true" && calendarEvent) {
      await backgroundQueue.add("calendar-event.update-bot-schedule", {
        calendarEventId: calendarEvent.id,
      });
      response.enqueued = true;
      response.message = `Bot scheduling job enqueued for event ${calendarEvent.id}`;
    }

    return res.json(response);
  } catch (err) {
    console.error("[DEBUG-BOT-CONFIG] Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

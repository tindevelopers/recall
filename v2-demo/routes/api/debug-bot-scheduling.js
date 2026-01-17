/**
 * Debug endpoint to check bot scheduling status for calendar events.
 *
 * GET /api/debug-bot-scheduling?calendarId=<id>
 *
 * Returns information about events, bot scheduling status, and diagnostics.
 */

import db from "../../db.js";
import Recall from "../../services/recall/index.js";

export default async (req, res) => {
  const { calendarId } = req.query;

  if (!calendarId) {
    return res.status(400).json({
      error: "Missing calendarId query parameter",
      usage: "GET /api/debug-bot-scheduling?calendarId=<uuid>",
    });
  }

  try {
    const calendar = await db.Calendar.findByPk(calendarId);
    if (!calendar) {
      return res.status(404).json({ error: `Calendar ${calendarId} not found` });
    }

    // Get all events for this calendar
    const events = await db.CalendarEvent.findAll({
      where: { calendarId: calendar.id },
      order: [["createdAt", "DESC"]],
      limit: 50,
    });

    // Analyze events
    const eventsAnalysis = events.map(event => {
      const recallData = event.recallData || {};
      const bots = recallData.bots || [];
      const hasBot = bots.length > 0;
      const botId = hasBot ? bots[0].id : null;
      
      return {
        id: event.id,
        recallId: event.recallId,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        meetingUrl: event.meetingUrl,
        shouldRecordAutomatic: event.shouldRecordAutomatic,
        shouldRecordManual: event.shouldRecordManual,
        hasMeetingUrl: !!event.meetingUrl,
        shouldHaveBot: (event.shouldRecordAutomatic || event.shouldRecordManual) && event.meetingUrl,
        hasBot: hasBot,
        botId: botId,
        botStatus: hasBot ? bots[0].status : null,
        isPast: event.endTime < new Date(),
        isFuture: event.startTime > new Date(),
      };
    });

    // Get calendar settings
    const calendarSettings = {
      autoRecordExternalEvents: calendar.autoRecordExternalEvents,
      autoRecordOnlyConfirmedEvents: calendar.autoRecordOnlyConfirmedEvents,
      enableTranscription: calendar.enableTranscription,
      transcriptionMode: calendar.transcriptionMode,
      recordVideo: calendar.recordVideo,
      recordAudio: calendar.recordAudio,
    };

    // Try to fetch latest calendar data from Recall
    let recallCalendarData = null;
    let recallError = null;
    try {
      if (calendar.recallId) {
        recallCalendarData = await Recall.getCalendar(calendar.recallId);
      }
    } catch (err) {
      recallError = err.message || String(err);
    }

    // Diagnostics
    const diagnostics = {
      issues: [],
      recommendations: [],
    };

    const eventsThatShouldHaveBots = eventsAnalysis.filter(e => e.shouldHaveBot && e.isFuture);
    const eventsWithBots = eventsAnalysis.filter(e => e.hasBot && e.isFuture);
    const eventsWithoutBots = eventsThatShouldHaveBots.filter(e => !e.hasBot);

    if (events.length === 0) {
      diagnostics.issues.push("No calendar events found in database");
      diagnostics.recommendations.push("Events may not be syncing from Recall.ai. Trigger a calendar sync.");
    }

    if (eventsThatShouldHaveBots.length > 0 && eventsWithoutBots.length > 0) {
      diagnostics.issues.push(`${eventsWithoutBots.length} future event(s) should have bots but don't`);
      diagnostics.recommendations.push("Check worker logs for bot scheduling errors. Manually trigger bot scheduling if needed.");
    }

    if (eventsAnalysis.some(e => e.shouldHaveBot && !e.hasMeetingUrl)) {
      diagnostics.issues.push("Some events that should be recorded don't have meeting URLs");
      diagnostics.recommendations.push("Ensure calendar events have meeting links (Zoom, Teams, etc.)");
    }

    if (!calendar.autoRecordExternalEvents && eventsAnalysis.every(e => !e.shouldRecordAutomatic && !e.shouldRecordManual)) {
      diagnostics.issues.push("Auto-record is disabled and no events are marked for manual recording");
      diagnostics.recommendations.push("Enable auto-record for external events or manually mark events for recording");
    }

    return res.json({
      calendar: {
        id: calendar.id,
        platform: calendar.platform,
        email: calendar.email,
        status: calendar.status,
        recallId: calendar.recallId,
      },
      calendarSettings,
      events: {
        total: events.length,
        future: eventsAnalysis.filter(e => e.isFuture).length,
        past: eventsAnalysis.filter(e => e.isPast).length,
        shouldHaveBots: eventsThatShouldHaveBots.length,
        withBots: eventsWithBots.length,
        withoutBots: eventsWithoutBots.length,
        analysis: eventsAnalysis,
      },
      recallCalendar: recallCalendarData,
      recallError,
      diagnostics,
    });
  } catch (error) {
    console.error("[DEBUG-BOT-SCHEDULING] Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

/**
 * Manual trigger endpoint to sync calendar events and schedule bots.
 * 
 * POST /api/trigger-calendar-sync?calendarId=<id>
 * 
 * This endpoint manually triggers:
 * 1. Event sync from Recall
 * 2. Auto-record status update
 * 3. Bot scheduling for eligible events
 */

import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import Recall from "../../services/recall/index.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { calendarId } = req.query;

  if (!calendarId) {
    return res.status(400).json({
      error: "Missing calendarId query parameter",
      usage: "POST /api/trigger-calendar-sync?calendarId=<uuid>",
    });
  }

  try {
    const calendar = await db.Calendar.findOne({
      where: {
        id: calendarId,
        userId: req.authentication.user.id,
      },
    });

    if (!calendar) {
      return res.status(404).json({ error: `Calendar ${calendarId} not found` });
    }

    // Sync events from the last 7 days to catch recent events
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    await backgroundQueue.add("recall.calendar.sync_events", {
      calendarId: calendar.id,
      recallId: calendar.recallId,
      lastUpdatedTimestamp: last7Days,
    });

    return res.json({
      success: true,
      message: `Triggered event sync for calendar ${calendar.email}`,
      calendar: {
        id: calendar.id,
        platform: calendar.platform,
        email: calendar.email,
        recallId: calendar.recallId,
      },
      syncWindow: "Last 7 days",
      note: "Events will be synced, auto-record status updated, and bots scheduled for eligible events",
    });
  } catch (error) {
    console.error("[TRIGGER-CALENDAR-SYNC] Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
};


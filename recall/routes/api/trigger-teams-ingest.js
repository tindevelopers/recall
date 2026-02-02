/**
 * Manual trigger endpoint for Teams recording ingestion
 * 
 * POST /api/trigger-teams-ingest
 * Body: { calendarEventId?: string, calendarId?: string }
 * 
 * If calendarEventId is provided, ingests that specific event
 * If calendarId is provided, checks all Teams meetings for that calendar
 */

import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

export default async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = req.authentication.user.id;

  try {
    const { calendarEventId, calendarId } = req.body;

    if (calendarEventId) {
      // Ingest specific calendar event
      const calendarEvent = await db.CalendarEvent.findByPk(calendarEventId, {
        include: [{ model: db.Calendar }],
      });

      if (!calendarEvent) {
        return res.status(404).json({ error: "Calendar event not found" });
      }

      // Verify user owns the calendar
      if (calendarEvent.Calendar?.userId !== userId) {
        return res.status(403).json({ error: "You don't have access to this calendar event" });
      }

      if (calendarEvent.platform !== "microsoft_outlook") {
        return res.status(400).json({ error: "Event is not a Microsoft Outlook calendar event" });
      }

      const meetingUrl = calendarEvent.meetingUrl;
      if (!meetingUrl || !meetingUrl.includes("teams.microsoft.com")) {
        return res.status(400).json({ error: "Event is not a Teams meeting" });
      }

      await backgroundQueue.add("teams.recording.ingest", {
        calendarEventId: calendarEvent.id,
      });

      return res.json({
        success: true,
        message: `Queued Teams recording ingestion for event ${calendarEventId}`,
        calendarEventId,
      });
    } else if (calendarId) {
      // Check all Teams meetings for this calendar
      const calendar = await db.Calendar.findByPk(calendarId);

      if (!calendar) {
        return res.status(404).json({ error: "Calendar not found" });
      }

      // Verify user owns the calendar
      if (calendar.userId !== userId) {
        return res.status(403).json({ error: "You don't have access to this calendar" });
      }

      if (calendar.platform !== "microsoft_outlook") {
        return res.status(400).json({ error: "Calendar is not a Microsoft Outlook calendar" });
      }

      // Find all Teams meetings that have ended
      const now = new Date();
      const teamsEvents = await db.CalendarEvent.findAll({
        where: {
          calendarId: calendar.id,
          platform: "microsoft_outlook",
        },
        include: [{ model: db.Calendar }],
      });

      const teamsMeetings = teamsEvents.filter((event) => {
        const meetingUrl = event.meetingUrl;
        const endTime = event.endTime;
        return (
          meetingUrl &&
          meetingUrl.includes("teams.microsoft.com") &&
          endTime &&
          endTime < now
        );
      });

      const ingestionJobs = [];
      for (const event of teamsMeetings) {
        await backgroundQueue.add("teams.recording.ingest", {
          calendarEventId: event.id,
        });
        ingestionJobs.push(event.id);
      }

      return res.json({
        success: true,
        message: `Queued Teams recording ingestion for ${ingestionJobs.length} meetings`,
        calendarId,
        queuedEvents: ingestionJobs,
      });
    } else {
      return res.status(400).json({
        error: "Either calendarEventId or calendarId must be provided",
      });
    }
  } catch (error) {
    console.error(`[API] Error triggering Teams ingestion:`, error);
    return res.status(500).json({
      error: "Failed to trigger Teams ingestion",
      message: error.message,
    });
  }
};


import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

/**
 * Update the transcription mode for a specific calendar event.
 * POST /meetings/:eventId/transcription-mode
 * Body: { transcriptionMode: 'realtime' | 'async' | null }
 */
export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { eventId } = req.params;
  const { transcriptionMode } = req.body;

  // Validate transcriptionMode
  const validModes = ["realtime", "async", null, "default"];
  if (!validModes.includes(transcriptionMode)) {
    return res.status(400).json({ 
      error: "Invalid transcription mode. Must be 'realtime', 'async', or 'default'" 
    });
  }

  try {
    // Find the event
    const event = await db.CalendarEvent.findByPk(eventId, {
      include: [{ model: db.Calendar }],
    });

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Verify the user owns this calendar
    if (event.Calendar.userId !== req.authentication.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Update the transcription mode (null means use calendar default)
    const newMode = transcriptionMode === "default" ? null : transcriptionMode;
    await event.update({ transcriptionMode: newMode });

    // Re-queue bot scheduling to apply the new transcription mode
    // This will update the bot config if a bot is already scheduled
    if (event.shouldRecordAutomatic || event.shouldRecordManual) {
      await backgroundQueue.add("calendarevent.update_bot_schedule", {
        calendarId: event.calendarId,
        recallEventId: event.recallId,
      });
      console.log(`[TRANSCRIPTION] Re-queued bot schedule for event ${event.id} with new mode: ${newMode || 'default'}`);
    }

    return res.json({ 
      success: true, 
      transcriptionMode: event.transcriptionMode,
      effectiveMode: event.transcriptionMode || event.Calendar.transcriptionMode || "realtime",
    });
  } catch (error) {
    console.error(`[TRANSCRIPTION] Error updating transcription mode for event ${eventId}:`, error);
    return res.status(500).json({ error: "Failed to update transcription mode" });
  }
};

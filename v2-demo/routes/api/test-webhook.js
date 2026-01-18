/**
 * Test endpoint to manually trigger webhook processing
 * POST /api/test-webhook
 * Body: { event: "calendar.sync_events", calendar_id: "..." }
 */

import db from "../../db.js";

export default async (req, res) => {
  // Allow unauthenticated access for testing (remove this in production if needed)
  // if (!req.authenticated) {
  //   return res.status(401).json({ error: "Unauthorized" });
  // }

  const { event = "calendar.sync_events", calendar_id: recallId } = req.body;

  if (!recallId) {
    return res.status(400).json({ error: "Missing calendar_id" });
  }

  try {
    const calendar = await db.Calendar.findOne({ where: { recallId } });
    if (!calendar) {
      return res.status(404).json({ error: `Calendar with recallId ${recallId} not found` });
    }

    // Simulate webhook payload
    const payload = {
      calendar_id: recallId,
      last_updated_ts: new Date().toISOString(),
    };

    // Save webhook directly
    const calendarWebhook = await db.CalendarWebhook.create({
      calendarId: calendar.id,
      event,
      payload,
      receivedAt: new Date(),
    });

    return res.json({
      success: true,
      message: "Test webhook saved",
      webhook: {
        id: calendarWebhook.id,
        calendarId: calendarWebhook.calendarId,
        event: calendarWebhook.event,
        receivedAt: calendarWebhook.receivedAt,
      },
    });
  } catch (error) {
    console.error("[TEST-WEBHOOK] Error:", error);
    return res.status(500).json({
      error: "Failed to save test webhook",
      message: error.message,
    });
  }
};


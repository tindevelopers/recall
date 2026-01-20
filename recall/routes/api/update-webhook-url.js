/**
 * Endpoint to update webhook URL for an existing calendar in Recall.ai
 *
 * POST /api/update-webhook-url
 * Body: { calendarId: "<uuid>" }
 *
 * This will update the webhook_url in Recall.ai to match the current PUBLIC_URL
 */

import db from "../../db.js";
import Recall from "../../services/recall/index.js";

export default async (req, res) => {
  const { calendarId } = req.body;

  if (!calendarId) {
    return res.status(400).json({
      error: "Missing calendarId in request body",
      usage: "POST /api/update-webhook-url with body: { calendarId: '<uuid>' }",
    });
  }

  try {
    const calendar = await db.Calendar.findByPk(calendarId);
    if (!calendar) {
      return res.status(404).json({ error: `Calendar ${calendarId} not found` });
    }

    if (!calendar.recallId) {
      return res.status(400).json({ 
        error: "Calendar does not have a recallId. Calendar may not be connected to Recall.ai" 
      });
    }

    const publicUrl = process.env.PUBLIC_URL;
    if (!publicUrl) {
      return res.status(500).json({ 
        error: "PUBLIC_URL environment variable is not set",
        recommendation: "Set PUBLIC_URL to your app's public URL (e.g., https://your-app.up.railway.app)"
      });
    }

    const webhookUrl = `${publicUrl}/webhooks/recall-calendar-updates`;

    console.log(`[UPDATE-WEBHOOK] Updating webhook URL for calendar ${calendarId} (recallId: ${calendar.recallId}) to ${webhookUrl}`);

    // Update the calendar in Recall.ai
    const updatedCalendar = await Recall.updateCalendar({
      id: calendar.recallId,
      data: {
        webhook_url: webhookUrl,
      },
    });

    // Update local calendar data
    calendar.recallData = updatedCalendar;
    await calendar.save();

    return res.json({
      success: true,
      message: "Webhook URL updated successfully",
      calendar: {
        id: calendar.id,
        platform: calendar.platform,
        email: calendar.email,
      },
      webhookUrl,
      recallCalendar: updatedCalendar,
    });
  } catch (error) {
    console.error("[UPDATE-WEBHOOK] Error:", error);
    return res.status(500).json({
      error: "Failed to update webhook URL",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

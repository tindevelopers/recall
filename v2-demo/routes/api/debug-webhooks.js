/**
 * Debug endpoint to inspect webhook configuration and status.
 *
 * GET /api/debug-webhooks?calendarId=<id>
 *
 * Returns webhook configuration, recent webhooks, and diagnostics.
 */

import db from "../../db.js";
import Recall from "../../services/recall/index.js";

export default async (req, res) => {
  const { calendarId } = req.query;

  if (!calendarId) {
    return res.status(400).json({
      error: "Missing calendarId query parameter",
      usage: "GET /api/debug-webhooks?calendarId=<uuid>",
    });
  }

  try {
    const calendar = await db.Calendar.findByPk(calendarId);
    if (!calendar) {
      return res.status(404).json({ error: `Calendar ${calendarId} not found` });
    }

    // Get recent webhooks for this calendar
    const recentWebhooks = await db.CalendarWebhook.findAll({
      where: { calendarId: calendar.id },
      order: [["receivedAt", "DESC"]],
      limit: 10,
    });

    // Get webhook URL configuration
    const publicUrl = process.env.PUBLIC_URL;
    const expectedWebhookUrl = publicUrl 
      ? `${publicUrl}/webhooks/recall-calendar-updates`
      : null;

    // Try to fetch current calendar data from Recall API
    let recallCalendarData = null;
    let recallWebhookUrl = null;
    let recallError = null;
    
    try {
      if (calendar.recallId) {
        recallCalendarData = await Recall.getCalendar(calendar.recallId);
        recallWebhookUrl = recallCalendarData?.webhook_url || null;
      }
    } catch (err) {
      recallError = err.message || String(err);
    }

    // Check if webhook URL matches
    const webhookUrlMatches = recallWebhookUrl === expectedWebhookUrl;

    const response = {
      calendar: {
        id: calendar.id,
        platform: calendar.platform,
        email: calendar.email,
        status: calendar.status,
        recallId: calendar.recallId,
      },
      webhookConfiguration: {
        expectedWebhookUrl,
        recallWebhookUrl,
        webhookUrlMatches,
        publicUrl: process.env.PUBLIC_URL || "(not set)",
        railwayPublicDomain: process.env.RAILWAY_PUBLIC_DOMAIN || "(not set)",
        railwayStaticUrl: process.env.RAILWAY_STATIC_URL || "(not set)",
      },
      recentWebhooks: {
        count: recentWebhooks.length,
        latest: recentWebhooks.length > 0 ? {
          event: recentWebhooks[0].event,
          receivedAt: recentWebhooks[0].receivedAt,
          payload: recentWebhooks[0].payload,
        } : null,
        all: recentWebhooks.map(w => ({
          id: w.id,
          event: w.event,
          receivedAt: w.receivedAt,
        })),
      },
      diagnostics: {
        issues: [],
        recommendations: [],
      },
    };

    // Add diagnostics
    if (!process.env.PUBLIC_URL) {
      response.diagnostics.issues.push("PUBLIC_URL environment variable is not set");
      response.diagnostics.recommendations.push(
        "Set PUBLIC_URL to your app's public URL (e.g., https://your-app.up.railway.app)"
      );
    }

    if (!webhookUrlMatches && recallWebhookUrl) {
      response.diagnostics.issues.push(
        `Webhook URL mismatch: Recall has "${recallWebhookUrl}" but expected "${expectedWebhookUrl}"`
      );
      response.diagnostics.recommendations.push(
        "Reconnect the calendar to update the webhook URL in Recall.ai"
      );
    }

    if (!recallWebhookUrl && calendar.recallId) {
      response.diagnostics.issues.push("No webhook URL configured in Recall.ai");
      response.diagnostics.recommendations.push(
        "Reconnect the calendar to set the webhook URL"
      );
    }

    if (recentWebhooks.length === 0) {
      response.diagnostics.issues.push("No webhooks received yet");
      response.diagnostics.recommendations.push(
        "If calendar is connected, webhooks should arrive when Recall.ai processes calendar updates"
      );
    }

    if (recallError) {
      response.diagnostics.issues.push(`Error fetching Recall calendar data: ${recallError}`);
    }

    return res.json(response);
  } catch (error) {
    console.error("[DEBUG-WEBHOOKS] Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

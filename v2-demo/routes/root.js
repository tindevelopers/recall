import { generateNotice } from "./utils.js";
import {
  buildGoogleCalendarOAuthUrl,
  buildMicrosoftOutlookOAuthUrl,
} from "../logic/oauth.js";
import { buildNotionOAuthUrl } from "../logic/notion-oauth.js";
import Recall from "../services/recall/index.js";
import { getPageOrDatabase } from "../services/notion/api-client.js";

export default async (req, res) => {
  if (req.authenticated) {
    const allCalendars = await req.authentication.user.getCalendars();
    
    // Filter out disconnected calendars - they shouldn't be displayed
    const calendars = allCalendars.filter((calendar) => {
      const status = calendar.status || calendar.recallData?.status;
      return status !== "disconnected" && status !== null && status !== undefined;
    });
    
    // Pick the most recently updated calendar per platform (we only support one connection
    // per platform per user; reconnect should update the existing record instead of creating a new one).
    // Only include connected calendars for OAuth URL building
    const calendarIdByPlatform = new Map();
    // Ensure deterministic ordering even if the association doesn't sort
    const calendarsSorted = [...calendars].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    for (const calendar of calendarsSorted) {
      const status = calendar.status || calendar.recallData?.status;
      // Only include connected calendars for reconnection URLs
      if (!calendarIdByPlatform.has(calendar.platform) && status === "connected") {
        calendarIdByPlatform.set(calendar.platform, calendar.id);
      }
    }
    
    // Refresh calendar data from Recall to get latest status
    // This ensures "connecting" becomes "connected" after Recall finishes
    // Also refresh calendars that don't have a status set yet
    for (const calendar of calendars) {
      const currentStatus = calendar.status || calendar.recallData?.status;
      if (currentStatus === "connecting" || !currentStatus) {
        try {
          const recallCalendar = await Recall.getCalendar(calendar.recallId);
          if (recallCalendar) {
            // Update recallData with latest from Recall API
            calendar.recallData = recallCalendar;
            await calendar.save();
          }
        } catch (err) {
          console.error(`Failed to refresh calendar ${calendar.id}:`, err.message);
        }
      }
    }
    
    const notionIntegration = await req.authentication.user.getIntegrations({
      where: { provider: "notion" },
      limit: 1,
    });
    const notionTarget = await req.authentication.user.getPublishTargets({
      where: { type: "notion" },
      limit: 1,
    });
    
    // Fetch details about the current Notion target if one exists
    let notionTargetDetails = null;
    if (notionIntegration?.[0] && notionTarget?.[0]?.config?.destinationId) {
      try {
        notionTargetDetails = await getPageOrDatabase({
          accessToken: notionIntegration[0].accessToken,
          id: notionTarget[0].config.destinationId,
        });
      } catch (err) {
        console.error("Failed to fetch Notion target details:", err.message);
      }
    }
    
    return res.render("index.ejs", {
      notice: req.notice,
      user: req.authentication.user,
      calendars,
      notion: {
        integration: notionIntegration?.[0] || null,
        target: notionTarget?.[0] || null,
        targetDetails: notionTargetDetails,
      },
      connectUrls: {
        googleCalendar: buildGoogleCalendarOAuthUrl({
          userId: req.authentication.user.id,
          calendarId: calendarIdByPlatform.get("google_calendar") || undefined,
        }),
        microsoftOutlook: buildMicrosoftOutlookOAuthUrl({
          userId: req.authentication.user.id,
          calendarId: calendarIdByPlatform.get("microsoft_outlook") || undefined,
        }),
        notion: buildNotionOAuthUrl({ userId: req.authentication.user.id }),
      },
    });
  } else {
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice("error", "You must be signed in to proceed.")
      )
    );
    return res.redirect("/sign-in");
  }
};

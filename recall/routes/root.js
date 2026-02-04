import { generateNotice } from "./utils.js";
import {
  buildGoogleCalendarOAuthUrl,
  buildMicrosoftOutlookOAuthUrl,
} from "../logic/oauth.js";
import { buildNotionOAuthUrl } from "../logic/notion-oauth.js";
import Recall from "../services/recall/index.js";
import { getPageOrDatabase } from "../services/notion/api-client.js";
import db from "../db.js";

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
    // Check for disconnected calendars and notify user
    let hasDisconnectedCalendar = false;
    let disconnectedCalendarEmails = [];
    
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
      
      // Check if calendar is disconnected
      if (currentStatus === "disconnected") {
        hasDisconnectedCalendar = true;
        const email = calendar.email || calendar.recallData?.platform_email || "your calendar";
        const platform = calendar.platform === "google_calendar" ? "Google Calendar" : "Microsoft Outlook";
        disconnectedCalendarEmails.push(`${platform} (${email})`);
      }
    }
    
    // Show notification if there are disconnected calendars
    if (hasDisconnectedCalendar && !req.notice) {
      const message = disconnectedCalendarEmails.length === 1
        ? `Your ${disconnectedCalendarEmails[0]} connection has been disconnected. Please reconnect your calendar to continue receiving meeting recordings.`
        : `Your calendar connections (${disconnectedCalendarEmails.join(", ")}) have been disconnected. Please reconnect them to continue receiving meeting recordings.`;
      
      const notice = generateNotice("error", message);
      req.notice = notice;
      // Set cookie so notice persists across page loads
      res.cookie("notice", JSON.stringify(notice));
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
    
    // Fetch upcoming meetings (next 7 days)
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const calendarIds = calendars.map(c => c.id);
    
    let upcomingMeetings = [];
    if (calendarIds.length > 0) {
      try {
        const { Op } = await import("sequelize");
        upcomingMeetings = await db.CalendarEvent.findAll({
          where: {
            calendarId: { [Op.in]: calendarIds },
          },
          order: [["createdAt", "DESC"]],
          limit: 100,
        });
        
        // Filter to upcoming meetings (start_time > now) and sort by start time
        // Keep more than 5 so "scroll for more" has content
        upcomingMeetings = upcomingMeetings
          .filter(event => {
            const startTime = new Date(event.recallData?.start_time);
            return startTime > now && startTime < sevenDaysFromNow;
          })
          .sort((a, b) => {
            const aTime = new Date(a.recallData?.start_time);
            const bTime = new Date(b.recallData?.start_time);
            return aTime - bTime;
          });
        // Pass all upcoming for scrollable list (view shows first 5 visible + scroll for more)
      } catch (err) {
        console.error("Failed to fetch upcoming meetings:", err.message);
      }
    }

    // Fetch last 5 past meetings (recorded/synced) for home
    let pastMeetings = [];
    try {
      const { Op } = await import("sequelize");
      const userId = req.authentication.user.id;
      let sharedArtifactIds = [];
      const user = await db.User.findByPk(userId);
      if (user?.email) {
        const shares = await db.MeetingShare.findAll({
          where: {
            status: "accepted",
            [Op.or]: [{ sharedWithUserId: userId }, { sharedWithEmail: user.email.toLowerCase() }],
          },
          attributes: ["meetingArtifactId"],
        });
        sharedArtifactIds = shares.map((s) => s.meetingArtifactId);
      }
      const artifactResult = await db.MeetingArtifact.findAll({
        where: {
          [Op.or]: [
            { userId },
            { ownerUserId: userId },
            ...(sharedArtifactIds.length > 0 ? [{ id: { [Op.in]: sharedArtifactIds } }] : []),
          ],
        },
        include: [
          { model: db.CalendarEvent, required: false },
          { model: db.MeetingSummary, required: false },
        ],
        order: [["createdAt", "DESC"]],
        limit: 5,
      });
      pastMeetings = artifactResult.map((artifact) => {
        const cal = artifact.CalendarEvent;
        const summary = (artifact.MeetingSummaries && artifact.MeetingSummaries[0]) || artifact.MeetingSummary;
        const data = artifact.rawPayload?.data || {};
        const startTime =
          data.start_time || (cal && cal.recallData?.start_time) || artifact.createdAt;
        const title =
          summary?.title ||
          (cal && (cal.recallData?.raw?.summary || cal.recallData?.raw?.subject)) ||
          data.title ||
          data.meeting_title ||
          "Meeting";
        const platform = cal?.platform || null;
        return {
          id: artifact.id,
          title: title || "Meeting",
          startTime,
          durationSeconds: data.duration_seconds || artifact.recordingDuration || null,
          platform,
          hasRecording: !!(data.video_url || data.recording_url || artifact.sourceRecordingUrl),
        };
      });
    } catch (err) {
      console.error("Failed to fetch past meetings:", err.message);
    }

    return res.render("index.ejs", {
      notice: req.notice,
      user: req.authentication.user,
      calendars,
      upcomingMeetings,
      pastMeetings,
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

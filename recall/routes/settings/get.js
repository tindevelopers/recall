import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;

  // Get all calendars for the user
  // Include disconnected calendars so users can see and reconnect them
  const allCalendars = await db.Calendar.findAll({
    where: { userId },
    order: [["createdAt", "ASC"]],
  });
  
  // Check for disconnected calendars and show notification
  const disconnectedCalendars = allCalendars.filter((calendar) => {
    const status = calendar.status || calendar.recallData?.status;
    return status === "disconnected";
  });
  
  // Show all calendars (including disconnected) so users can see status
  const calendars = allCalendars;
  
  // Add notice if there are disconnected calendars
  let notice = req.notice;
  if (disconnectedCalendars.length > 0 && !notice) {
    const { generateNotice } = await import("../utils.js");
    const disconnectedEmails = disconnectedCalendars.map(cal => {
      const email = cal.email || cal.recallData?.platform_email || "your calendar";
      const platform = cal.platform === "google_calendar" ? "Google Calendar" : "Microsoft Outlook";
      return `${platform} (${email})`;
    });
    
    const message = disconnectedEmails.length === 1
      ? `Your ${disconnectedEmails[0]} connection has been disconnected. Please reconnect your calendar to continue receiving meeting recordings.`
      : `Your calendar connections (${disconnectedEmails.join(", ")}) have been disconnected. Please reconnect them to continue receiving meeting recordings.`;
    
    notice = generateNotice("error", message);
  }

  // If no calendars, render settings page with empty state
  if (calendars.length === 0) {
    return res.render("settings.ejs", {
      notice: notice || req.notice,
      user: req.authentication.user,
      calendars: [],
      calendar: null,
      webhooks: [],
      notionDestination: null,
    });
  }

  // Get the selected calendar (from query param or default to first)
  const calendarId = req.query.calendarId || calendars[0].id;
  // Note: calendar.id is a UUID string, not an integer
  const calendar = calendars.find((c) => c.id === calendarId) || calendars[0];

  // Get webhook count for the selected calendar (for badge display)
  // Actual webhooks are loaded via API with pagination for faster page load
  const webhookCount = await db.CalendarWebhook.count({
    where: { calendarId: calendar.id },
  });

  // Get Notion destination if connected (if model exists)
  let notionDestination = null;
  if (db.NotionDestination) {
    notionDestination = await db.NotionDestination.findOne({
      where: { userId },
    });
  }

  // Publishing targets
  const publishTargets = await db.PublishTarget.findAll({
    where: { userId },
  });
  const slackTarget = publishTargets.find((t) => t.type === "slack") || null;
  const teamworkTarget = publishTargets.find((t) => t.type === "teamwork") || null;
  const notionTarget = publishTargets.find((t) => t.type === "notion") || null;

  return res.render("settings.ejs", {
    notice: notice || req.notice,
    user: req.authentication.user,
    calendars,
    calendar,
    webhookCount,
    notionDestination,
    publishTargets,
    slackTarget,
    teamworkTarget,
    notionTarget,
  });
};

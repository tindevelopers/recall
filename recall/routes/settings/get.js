import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;

  // Get all calendars for the user, filtering out disconnected ones
  const allCalendars = await db.Calendar.findAll({
    where: { userId },
    order: [["createdAt", "ASC"]],
  });
  
  // Filter out disconnected calendars - they shouldn't be displayed
  const calendars = allCalendars.filter((calendar) => {
    const status = calendar.status || calendar.recallData?.status;
    return status !== "disconnected" && status !== null && status !== undefined;
  });

  // If no calendars, render settings page with empty state
  if (calendars.length === 0) {
    return res.render("settings.ejs", {
      notice: req.notice,
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

  return res.render("settings.ejs", {
    notice: req.notice,
    user: req.authentication.user,
    calendars,
    calendar,
    webhookCount,
    notionDestination,
  });
};

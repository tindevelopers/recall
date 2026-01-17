import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;

  // Get all calendars for the user
  const calendars = await db.Calendar.findAll({
    where: { userId },
    order: [["createdAt", "ASC"]],
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
  const calendar = calendars.find((c) => c.id === parseInt(calendarId)) || calendars[0];

  // Get webhooks for the selected calendar
  const webhooks = await db.CalendarWebhook.findAll({
    where: { calendarId: calendar.id },
    order: [["receivedAt", "DESC"]],
    limit: 50,
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
    webhooks,
    notionDestination,
  });
};

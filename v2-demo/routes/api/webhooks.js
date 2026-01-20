import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = req.authentication.user.id;
  const calendarId = req.query.calendarId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  if (!calendarId) {
    return res.status(400).json({ error: "calendarId is required" });
  }

  // Verify the calendar belongs to this user
  const calendar = await db.Calendar.findOne({
    where: { id: calendarId, userId },
  });

  if (!calendar) {
    return res.status(404).json({ error: "Calendar not found" });
  }

  // Get total count for pagination
  const totalCount = await db.CalendarWebhook.count({
    where: { calendarId },
  });

  // Get paginated webhooks
  const webhooks = await db.CalendarWebhook.findAll({
    where: { calendarId },
    order: [["receivedAt", "DESC"]],
    limit,
    offset,
  });

  const totalPages = Math.ceil(totalCount / limit);

  return res.json({
    webhooks,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  });
};


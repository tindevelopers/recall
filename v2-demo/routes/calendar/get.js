import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/");
  } else {
    const calendar = await db.Calendar.findOne({
      where: {
        id: req.params.id,
        userId: req.authentication.user.id,
      },
    });
    
    // Check if calendar exists and is not disconnected
    if (calendar) {
      const status = calendar.status || calendar.recallData?.status;
      if (status === "disconnected") {
        // Calendar was disconnected/deleted, return 404
        return res.render("404.ejs", {
          notice: req.notice,
        });
      }
      const webhooks = await calendar.getCalendarWebhooks({
        order: [["receivedAt", "DESC"]],
      });

      return res.render("calendar.ejs", {        
        calendar,
        webhooks,
        notice: req.notice,
        user: req.authentication.user,
      });
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};

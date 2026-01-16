import { generateNotice } from "../utils.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/");
  } else {
    const calendar = await db.Calendar.findByPk(req.params.id);
    if (calendar) {
      // Queue a job to refresh calendar data from Recall
      backgroundQueue.add("recall.calendar.update", {
        calendarId: calendar.id,
        recallId: calendar.recallId,
      });
      
      res.cookie(
        "notice",
        JSON.stringify(
          generateNotice(
            "success",
            `Refreshing calendar status for ${calendar.email || calendar.recallId}...`
          )
        )
      );
      
      return res.redirect(`/calendar/${calendar.id}`);
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};


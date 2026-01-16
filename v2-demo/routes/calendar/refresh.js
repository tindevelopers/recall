import { generateNotice } from "../utils.js";
import db from "../../db.js";
import Recall from "../../services/recall/index.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/");
  } else {
    const calendar = await db.Calendar.findByPk(req.params.id);
    if (calendar) {
      try {
        // Fetch the latest calendar data from Recall synchronously
        const recallCalendar = await Recall.getCalendar(calendar.recallId);
        calendar.recallData = recallCalendar;
        await calendar.save();
        
        const status = recallCalendar.status || "unknown";
        const email = recallCalendar.platform_email || calendar.recallId;
        
        res.cookie(
          "notice",
          JSON.stringify(
            generateNotice(
              "success",
              `Calendar status refreshed: ${status}${email !== calendar.recallId ? ` (${email})` : ""}`
            )
          )
        );
      } catch (error) {
        console.error(`ERROR: Failed to refresh calendar ${calendar.id}:`, error);
        res.cookie(
          "notice",
          JSON.stringify(
            generateNotice(
              "error",
              `Failed to refresh calendar data: ${error.message}`
            )
          )
        );
      }
      
      return res.redirect(`/calendar/${calendar.id}`);
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};


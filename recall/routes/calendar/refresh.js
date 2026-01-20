import { generateNotice } from "../utils.js";
import db from "../../db.js";
import Recall from "../../services/recall/index.js";

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
        // If calendar was deleted from Recall (404), mark it as disconnected locally
        if (error.res && error.res.status === 404) {
          console.log(`Calendar ${calendar.recallId} not found in Recall (was disconnected); marking as disconnected locally.`);
          const updatedRecallData = {
            ...calendar.recallData,
            status: 'disconnected'
          };
          calendar.recallData = updatedRecallData;
          await calendar.save();
          
          res.cookie(
            "notice",
            JSON.stringify(
              generateNotice(
                "success",
                `Calendar is disconnected. It was removed from Recall.`
              )
            )
          );
        } else {
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
      }
      
      return res.redirect(`/calendar/${calendar.id}`);
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};


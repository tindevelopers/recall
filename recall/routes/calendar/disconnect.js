import { generateNotice } from "../utils.js";
import db from "../../db.js";
import Recall from '../../services/recall/index.js'

// Disconnect calendar route - removes calendar from Recall API but keeps local record for reconnection
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
        // Delete the calendar from Recall API (this removes the OAuth connection)
        // If the calendar was already deleted from Recall, this might fail, but we'll still delete it locally
        try {
          await Recall.deleteCalendar(calendar.recallId);
        } catch (deleteError) {
          // If calendar was already deleted from Recall, that's okay - we'll still delete it locally
          console.log(`Calendar ${calendar.recallId} may have already been deleted from Recall: ${deleteError.message}`);
        }
        
        // Delete the calendar from local database
        // This ensures disconnected calendars don't show up and forces a fresh OAuth flow on reconnect
        const calendarEmail = calendar.email;
        await calendar.destroy();

        res.cookie(
          "notice",
          JSON.stringify(
            generateNotice(
              "success",
              `Calendar (${calendarEmail}) disconnected successfully. You can reconnect it via the Connect button.`
            )
          )
        );
      } catch (error) {
        console.error(`Error disconnecting calendar ${calendar.id}:`, error);
        res.cookie(
          "notice",
          JSON.stringify(
            generateNotice(
              "error",
              `Failed to disconnect calendar: ${error.message}`
            )
          )
        );
      }
      return res.redirect("/");
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};


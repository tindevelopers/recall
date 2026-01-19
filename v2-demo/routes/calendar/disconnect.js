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
        // Disconnect the calendar via Recall API (this removes the OAuth connection)
        // If the calendar was already deleted from Recall, this might fail, but we'll still mark it as disconnected locally
        try {
          await Recall.deleteCalendar(calendar.recallId);
        } catch (deleteError) {
          // If calendar was already deleted from Recall, that's okay - we'll just mark it as disconnected locally
          console.log(`Calendar ${calendar.recallId} may have already been deleted from Recall: ${deleteError.message}`);
        }
        
        // Mark the calendar as disconnected locally
        // Note: The calendar record is kept so it can be reconnected later
        // The recallId is kept even though the calendar is deleted from Recall
        // When reconnecting via OAuth callback, it will handle updating or creating the calendar
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
              `Calendar (${calendar.email}) disconnected successfully. You can reconnect it later.`
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


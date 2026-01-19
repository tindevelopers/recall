import { generateNotice } from "../utils.js";
import db from "../../db.js";
import Recall from '../../services/recall/index.js'

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
      const calendarId = calendar.id;
      const calendarEmail = calendar.email;
      
      try {
        // Try to delete from Recall API first
        // If the calendar was already deleted from Recall, that's okay - we'll still delete it locally
        try {
          await Recall.deleteCalendar(calendar.recallId);
        } catch (deleteError) {
          // If calendar was already deleted from Recall, that's okay - we'll just delete it locally
          console.log(`Calendar ${calendar.recallId} may have already been deleted from Recall: ${deleteError.message}`);
        }
      } catch (error) {
        console.error(`Error deleting calendar from Recall API:`, error);
        // Continue with local deletion even if Recall API deletion fails
      }
      
      // Delete from local database
      await calendar.destroy();

      res.cookie(
        "notice",
        JSON.stringify(
          generateNotice(
            "success",
            `Calendar(ID: ${calendarId}, email: ${calendarEmail}) deleted successfully.`
          )
        )
      );
      return res.redirect("/");
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};

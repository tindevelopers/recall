import { generateNotice } from "../utils.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { updateAutoRecordStatusForCalendarEvents } from "../../logic/autorecord.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/");
  } else {
    const event = await db.CalendarEvent.findByPk(req.params.id);
    if (event) {
      const calendar = await event.getCalendar();
      if (!calendar || calendar.userId !== req.authentication.user.id) {
        return res.render("404.ejs", {
          notice: req.notice,
        });
      }

      const { manualRecord = null } = req.body || {};
      console.log(
        `INFO: Will set manual record to ${manualRecord} for event(ID: ${event.id}).`
      );
      
      event.shouldRecordManual = manualRecord;
      await event.save();

      res.cookie(
        "notice",
        JSON.stringify(
          generateNotice(
            "success",
            `Recording ${manualRecord === 'true' || manualRecord === true ? 'enabled' : 'disabled'} for "${event.title || 'meeting'}".`
          )
        )
      );

      await updateAutoRecordStatusForCalendarEvents({
        calendar,
        events: [event],
      });
      backgroundQueue.add("calendarevent.update_bot_schedule", {
        calendarId: calendar.id,
        recallEventId: event.recallId,
      });

      // Redirect back to meetings page
      return res.redirect(`/meetings`);
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};

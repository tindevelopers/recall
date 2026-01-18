import { generateNotice } from "../utils.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { updateAutoRecordStatusForCalendarEvents } from "../../logic/autorecord.js";

export default async (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update.js:7',message:'PATCH /calendar/:id handler entry',data:{calendarId:req.params.id,method:req.method,bodyKeys:Object.keys(req.body||{}),hasAutoRecordExternalEvents:'autoRecordExternalEvents' in req.body,hasAutoRecordInternalEvents:'autoRecordInternalEvents' in req.body,hasRecordVideo:'recordVideo' in req.body,hasRecordAudio:'recordAudio' in req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  if (!req.authenticated) {
    return res.redirect("/");
  } else {
    const calendar = await db.Calendar.findOne({
      where: {
        id: req.params.id,
        userId: req.authentication.user.id,
      },
    });
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update.js:15',message:'Calendar lookup result',data:{calendarId:req.params.id,calendarFound:!!calendar,calendarEmail:calendar?.email},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (calendar) {
      // html form payload does not include unchecked checkboxes, so we default to "off".
      const {
        autoRecordExternalEvents = "off",
        autoRecordInternalEvents = "off",
        autoRecordOnlyConfirmedEvents = "off",
        useRetellTranscription = "off",
        recordVideo = "off",
        recordAudio = "off",
      } = req.body || {};
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update.js:24',message:'Parsed form values BEFORE update',data:{autoRecordExternalEvents,autoRecordInternalEvents,autoRecordOnlyConfirmedEvents,useRetellTranscription,recordVideo:req.body?.recordVideo,recordAudio:req.body?.recordAudio,currentAutoRecordExternalEvents:calendar.autoRecordExternalEvents,currentAutoRecordInternalEvents:calendar.autoRecordInternalEvents,currentRecordVideo:calendar.recordVideo,currentRecordAudio:calendar.recordAudio},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      calendar.autoRecordExternalEvents = autoRecordExternalEvents === "on" ? true : false;
      calendar.autoRecordInternalEvents = autoRecordInternalEvents === "on" ? true : false;
      calendar.autoRecordOnlyConfirmedEvents = autoRecordOnlyConfirmedEvents === "on" ? true : false;
      calendar.useRetellTranscription = useRetellTranscription === "on" ? true : false;
      // Also handle recordVideo and recordAudio if provided (from settings page)
      // Check if field exists in body (not just default value) to avoid overwriting when not present
      if ("recordVideo" in req.body) {
        calendar.recordVideo = recordVideo === "on";
      }
      if ("recordAudio" in req.body) {
        calendar.recordAudio = recordAudio === "on";
      }
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update.js:29',message:'Calendar values AFTER assignment, BEFORE save',data:{autoRecordExternalEvents:calendar.autoRecordExternalEvents,autoRecordInternalEvents:calendar.autoRecordInternalEvents,autoRecordOnlyConfirmedEvents:calendar.autoRecordOnlyConfirmedEvents,useRetellTranscription:calendar.useRetellTranscription,recordVideo:calendar.recordVideo,recordAudio:calendar.recordAudio,hasRecordVideoInBody:'recordVideo' in req.body,hasRecordAudioInBody:'recordAudio' in req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'FIXED'})}).catch(()=>{});
      // #endregion
      await calendar.save();
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update.js:30',message:'Calendar saved successfully',data:{calendarId:calendar.id,autoRecordExternalEvents:calendar.autoRecordExternalEvents,autoRecordInternalEvents:calendar.autoRecordInternalEvents,autoRecordOnlyConfirmedEvents:calendar.autoRecordOnlyConfirmedEvents,useRetellTranscription:calendar.useRetellTranscription,recordVideo:calendar.recordVideo,recordAudio:calendar.recordAudio},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      res.cookie(
        "notice",
        JSON.stringify(
          generateNotice(
            "success",
            `Calendar(ID: ${calendar.id}, email: ${calendar.email}) recording preferences updated successfully.`
          )
        )
      );

      const [webhooks, events] = await Promise.all([
        calendar.getCalendarWebhooks({
          order: [["receivedAt", "DESC"]],
        }),
        // todo: filter out events that have ended/ongoing
        calendar.getCalendarEvents(),
      ]);

      await updateAutoRecordStatusForCalendarEvents({ calendar, events });
      events.forEach((event) => {
        backgroundQueue.add("calendarevent.update_bot_schedule", {
          calendarId: calendar.id,
          recallEventId: event.recallId,
        });
      });

      return res.redirect(`/calendar/${calendar.id}`);
    } else {
      return res.render("404.ejs", {
        notice: req.notice,
      });
    }
  }
};

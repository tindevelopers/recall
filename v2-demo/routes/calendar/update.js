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
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update.js:24',message:'Parsed form values BEFORE update',data:{autoRecordExternalEvents,autoRecordInternalEvents,autoRecordOnlyConfirmedEvents,useRetellTranscription,recordVideoRaw:req.body?.recordVideo,recordAudioRaw:req.body?.recordAudio,recordVideoIsArray:Array.isArray(req.body?.recordVideo),recordAudioIsArray:Array.isArray(req.body?.recordAudio),currentAutoRecordExternalEvents:calendar.autoRecordExternalEvents,currentAutoRecordInternalEvents:calendar.autoRecordInternalEvents,currentRecordVideo:calendar.recordVideo,currentRecordAudio:calendar.recordAudio},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'G'})}).catch(()=>{});
      // #endregion

      calendar.autoRecordExternalEvents = autoRecordExternalEvents === "on" ? true : false;
      calendar.autoRecordInternalEvents = autoRecordInternalEvents === "on" ? true : false;
      calendar.autoRecordOnlyConfirmedEvents = autoRecordOnlyConfirmedEvents === "on" ? true : false;
      calendar.useRetellTranscription = useRetellTranscription === "on" ? true : false;
      // Also handle recordVideo and recordAudio if provided (from settings page)
      // Settings form includes hidden inputs so these fields are always present when form is from settings page
      // Calendar page form doesn't include these fields, so they won't be in req.body
      // Note: When checkbox is checked, both checkbox ("on") and hidden input ("off") are sent
      // Express creates an array, so we need to check if "on" is in the array
      if ("recordVideo" in req.body) {
        const recordVideoValue = Array.isArray(req.body.recordVideo) 
          ? req.body.recordVideo.includes("on") ? "on" : "off"
          : req.body.recordVideo;
        calendar.recordVideo = recordVideoValue === "on";
      }
      if ("recordAudio" in req.body) {
        const recordAudioValue = Array.isArray(req.body.recordAudio)
          ? req.body.recordAudio.includes("on") ? "on" : "off"
          : req.body.recordAudio;
        calendar.recordAudio = recordAudioValue === "on";
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

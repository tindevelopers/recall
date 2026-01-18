import { generateNotice } from "../utils.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

export default async (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update-bot-settings.js:6',message:'PATCH /calendar/:id/bot-settings handler entry',data:{calendarId:req.params.id,method:req.method,bodyKeys:Object.keys(req.body||{}),hasRecordVideo:'recordVideo' in req.body,hasRecordAudio:'recordAudio' in req.body,hasAutoRecordExternalEvents:'autoRecordExternalEvents' in req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  if (!req.authenticated) {
    return res.redirect("/");
  }

  const calendar = await db.Calendar.findOne({
    where: {
      id: req.params.id,
      userId: req.authentication.user.id,
    },
  });

  if (!calendar) {
    return res.render("404.ejs", {
      notice: req.notice,
    });
  }

  // HTML form payload does not include unchecked checkboxes, so we default to "off"
  const {
    // Bot appearance
    botName = "Meeting Assistant",
    botAvatarUrl = "",
    // Recording
    recordVideo = "off",
    recordAudio = "off",
    // Transcription
    enableTranscription = "off",
    transcriptionLanguage = "en",
    transcriptionMode = "realtime",
    // AI enrichment
    enableSummary = "off",
    enableActionItems = "off",
    enableFollowUps = "off",
    // Publishing
    autoPublishToNotion = "off",
    // Bot behavior
    joinBeforeStartMinutes = "1",
    leaveAfterEndMinutes = "0",
    autoLeaveIfAlone = "off",
    autoLeaveAloneTimeoutSeconds = "60",
  } = req.body || {};

  // Update bot appearance settings
  calendar.botName = botName.trim() || "Meeting Assistant";
  calendar.botAvatarUrl = botAvatarUrl.trim() || null;

  // Update recording settings
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update-bot-settings.js:54',message:'Recording settings BEFORE update',data:{recordVideo,recordAudio,currentRecordVideo:calendar.recordVideo,currentRecordAudio:calendar.recordAudio},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  calendar.recordVideo = recordVideo === "on";
  calendar.recordAudio = recordAudio === "on";
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update-bot-settings.js:56',message:'Recording settings AFTER assignment, BEFORE save',data:{recordVideo:calendar.recordVideo,recordAudio:calendar.recordAudio},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

  // Update transcription settings
  calendar.enableTranscription = enableTranscription === "on";
  calendar.transcriptionLanguage = transcriptionLanguage;
  calendar.transcriptionMode = transcriptionMode === "async" ? "async" : "realtime";

  // Update AI enrichment settings
  calendar.enableSummary = enableSummary === "on";
  calendar.enableActionItems = enableActionItems === "on";
  calendar.enableFollowUps = enableFollowUps === "on";

  // Update publishing settings
  calendar.autoPublishToNotion = autoPublishToNotion === "on";

  // Update bot behavior settings
  calendar.joinBeforeStartMinutes = Math.max(0, Math.min(15, parseInt(joinBeforeStartMinutes, 10) || 1));
  calendar.leaveAfterEndMinutes = Math.max(0, Math.min(30, parseInt(leaveAfterEndMinutes, 10) || 0));
  calendar.autoLeaveIfAlone = autoLeaveIfAlone === "on";
  calendar.autoLeaveAloneTimeoutSeconds = Math.max(10, Math.min(300, parseInt(autoLeaveAloneTimeoutSeconds, 10) || 60));

  await calendar.save();
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update-bot-settings.js:75',message:'Bot settings saved successfully',data:{calendarId:calendar.id,recordVideo:calendar.recordVideo,recordAudio:calendar.recordAudio,autoRecordExternalEvents:calendar.autoRecordExternalEvents,autoRecordInternalEvents:calendar.autoRecordInternalEvents},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

  res.cookie(
    "notice",
    JSON.stringify(
      generateNotice(
        "success",
        `Bot settings for ${calendar.email} updated successfully.`
      )
    )
  );

  // Re-schedule bots for all future events with the new settings
  const events = await calendar.getCalendarEvents();
  events.forEach((event) => {
    backgroundQueue.add("calendarevent.update_bot_schedule", {
      calendarId: calendar.id,
      recallEventId: event.recallId,
    });
  });

  return res.redirect(`/calendar/${calendar.id}`);
};

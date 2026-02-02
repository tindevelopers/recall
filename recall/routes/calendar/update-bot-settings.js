import { generateNotice } from "../utils.js";
import db from "../../db.js";
import { queueBotScheduleJob } from "../../utils/queue-bot-schedule.js";

export default async (req, res) => {
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

  // #region agent log
  const oldSettings = {
    botName: calendar.botName,
    recordVideo: calendar.recordVideo,
    recordAudio: calendar.recordAudio,
    enableTranscription: calendar.enableTranscription,
    transcriptionMode: calendar.transcriptionMode,
    enableSummary: calendar.enableSummary,
    joinBeforeStartMinutes: calendar.joinBeforeStartMinutes,
  };
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update-bot-settings.js:before_update',message:'Settings before update',data:{calendarId:calendar.id,email:calendar.email,oldSettings:oldSettings,requestBody:req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-change',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

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
    aiProvider = "recall",
    aiModel = "",
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
  calendar.recordVideo = recordVideo === "on";
  calendar.recordAudio = recordAudio === "on";

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

  // Update AI provider and model settings
  const validProviders = ["recall", "openai", "assemblyai", "anthropic"];
  if (validProviders.includes(aiProvider)) {
    calendar.aiProvider = aiProvider;
  }
  calendar.aiModel = aiModel && aiModel.trim() ? aiModel.trim() : null;

  // Update bot behavior settings
  calendar.joinBeforeStartMinutes = Math.max(0, Math.min(15, parseInt(joinBeforeStartMinutes, 10) || 1));
  calendar.leaveAfterEndMinutes = Math.max(0, Math.min(30, parseInt(leaveAfterEndMinutes, 10) || 0));
  calendar.autoLeaveIfAlone = autoLeaveIfAlone === "on";
  calendar.autoLeaveAloneTimeoutSeconds = Math.max(10, Math.min(300, parseInt(autoLeaveAloneTimeoutSeconds, 10) || 60));

  await calendar.save();

  // #region agent log
  const newSettings = {
    botName: calendar.botName,
    recordVideo: calendar.recordVideo,
    recordAudio: calendar.recordAudio,
    enableTranscription: calendar.enableTranscription,
    transcriptionMode: calendar.transcriptionMode,
    enableSummary: calendar.enableSummary,
    joinBeforeStartMinutes: calendar.joinBeforeStartMinutes,
  };
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update-bot-settings.js:after_save',message:'Settings after save',data:{calendarId:calendar.id,email:calendar.email,newSettings:newSettings},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-change',hypothesisId:'A'})}).catch(()=>{});
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
  
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update-bot-settings.js:events_found',message:'Events to reschedule',data:{calendarId:calendar.id,eventsCount:events.length,eventIds:events.slice(0,10).map(e=>({id:e.id,recallId:e.recallId,title:e.title,startTime:e.startTime}))},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-change',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  for (const event of events) {
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/calendar/update-bot-settings.js:queue_job',message:'Queueing bot schedule job with forceReschedule',data:{calendarId:calendar.id,eventId:event.id,recallId:event.recallId,title:event.title},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-change',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    // Use forceReschedule: true to ensure settings changes are applied even if a job was already processed
    await queueBotScheduleJob(event.recallId, calendar.id, { forceReschedule: true });
  }

  return res.redirect(`/calendar/${calendar.id}`);
};

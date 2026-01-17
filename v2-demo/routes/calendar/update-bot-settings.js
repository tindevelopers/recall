import { generateNotice } from "../utils.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

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

  // Update bot behavior settings
  calendar.joinBeforeStartMinutes = Math.max(0, Math.min(15, parseInt(joinBeforeStartMinutes, 10) || 1));
  calendar.leaveAfterEndMinutes = Math.max(0, Math.min(30, parseInt(leaveAfterEndMinutes, 10) || 0));
  calendar.autoLeaveIfAlone = autoLeaveIfAlone === "on";
  calendar.autoLeaveAloneTimeoutSeconds = Math.max(10, Math.min(300, parseInt(autoLeaveAloneTimeoutSeconds, 10) || 60));

  await calendar.save();

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

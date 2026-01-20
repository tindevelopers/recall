import { Router } from "express";

import root from "./root.js";
import catchAll from "./catch-all.js";
import signInGet from "./sign-in/get.js";
import signInPost from "./sign-in/post.js";
import signUpGet from "./sign-up/get.js";
import signUpPost from "./sign-up/post.js";
import signOutPost from "./sign-out/post.js";
import calendarGet from "./calendar/get.js";
import calendarDelete from "./calendar/delete.js";
import calendarDisconnect from "./calendar/disconnect.js";
import calendarUpdate from "./calendar/update.js";
import calendarUpdateBotSettings from "./calendar/update-bot-settings.js";
import calendarRefresh from "./calendar/refresh.js";
import calendarEventSetManualRecord from "./calendar-event/set-manual-record.js";
import oauthCallbackGoogleCalendar from "./oauth-callback/google-calendar.js";
import oauthCallbackMicrosoftOutlook from "./oauth-callback/microsoft-outlook.js";
import notionConnect from "./oauth/notion-connect.js";
import oauthCallbackNotion from "./oauth-callback/notion.js";
import webhooksRecallCalendarUpdates from "./webhooks/recall-calendar-updates.js";
import webhooksRecallNotes from "./webhooks/recall-notes.js";
import notionTarget from "./integrations/notion-target.js";
import apiChatMeetings from "./api/chat/meetings.js";
import apiNotionPages, { getNotionPageDetails } from "./api/notion-pages.js";
import apiCheckBot from "./api/check-bot.js";
import apiDebugCalendars from "./api/debug-calendars.js";
import apiDebugBotConfig from "./api/debug-bot-config.js";
import apiDebugWebhooks from "./api/debug-webhooks.js";
import apiDebugBotScheduling from "./api/debug-bot-scheduling.js";
import apiDiagnoseBotScheduling from "./api/diagnose-bot-scheduling.js";
import apiTriggerCalendarSync from "./api/trigger-calendar-sync.js";
import apiTestWebhook from "./api/test-webhook.js";
import apiCheckMeetingPayload from "./api/check-meeting-payload.js";
import apiUpdateWebhookUrl from "./api/update-webhook-url.js";
import meetingsList from "./meetings/list.js";
import meetingsDetail from "./meetings/detail.js";
import meetingsUpdateTranscriptionMode from "./meetings/update-transcription-mode.js";
import { getTranscript, getSummary, getActionItems, triggerEnrichment } from "./api/meeting-details.js";
import refreshRecording from "./api/refresh-recording.js";
import publishMeeting from "./api/publish-meeting.js";
import settingsGet from "./settings/get.js";
import apiWebhooks from "./api/webhooks.js";

const router = Router();

router.get("/", root);

router.get("/sign-in", signInGet);
router.post("/sign-in", signInPost);

router.get("/sign-up", signUpGet);
router.post("/sign-up", signUpPost);

router.post("/sign-out", signOutPost);

router.get("/calendar/:id", calendarGet);
router.patch("/calendar/:id", calendarUpdate);
router.patch("/calendar/:id/bot-settings", calendarUpdateBotSettings);
router.delete("/calendar/:id", calendarDelete);
router.post("/calendar/:id/disconnect", calendarDisconnect);
router.post("/calendar/:id/refresh", calendarRefresh);

router.patch("/calendar-event/:id/set-manual-record", calendarEventSetManualRecord);

router.get("/oauth-callback/google-calendar", oauthCallbackGoogleCalendar);
router.get("/oauth-callback/microsoft-outlook", oauthCallbackMicrosoftOutlook);
router.get("/oauth/notion", notionConnect);
router.get("/oauth-callback/notion", oauthCallbackNotion);

router.all("/webhooks/recall-calendar-updates", webhooksRecallCalendarUpdates);
router.post("/webhooks/recall-notes", webhooksRecallNotes);

router.post("/integrations/notion-target", notionTarget);
router.get("/api/notion/pages", apiNotionPages);
router.get("/api/notion/pages/:id", getNotionPageDetails);
router.post("/api/chat/meetings", apiChatMeetings);
router.get("/api/check-bot", apiCheckBot);
router.get("/api/debug-calendars", apiDebugCalendars);
router.get("/api/debug-bot-config", apiDebugBotConfig);
router.post("/api/debug-bot-config", apiDebugBotConfig);
router.get("/api/debug-webhooks", apiDebugWebhooks);
router.get("/api/debug-bot-scheduling", apiDebugBotScheduling);
router.get("/api/diagnose-bot-scheduling", apiDiagnoseBotScheduling);
router.post("/api/trigger-calendar-sync", apiTriggerCalendarSync);
router.post("/api/test-webhook", apiTestWebhook);
router.get("/api/check-meeting-payload", apiCheckMeetingPayload);
router.post("/api/update-webhook-url", apiUpdateWebhookUrl);

router.get("/meetings", meetingsList);
router.get("/meetings/:id", meetingsDetail);
router.post("/meetings/:eventId/transcription-mode", meetingsUpdateTranscriptionMode);

// Meeting details API for lazy-loading modals
router.get("/api/meetings/:meetingId/transcript", getTranscript);
router.get("/api/meetings/:meetingId/summary", getSummary);
router.get("/api/meetings/:meetingId/actions", getActionItems);
router.post("/api/meetings/enrich", triggerEnrichment);
router.post("/api/meetings/:meetingId/refresh-recording", refreshRecording);
router.post("/api/meetings/:meetingId/publish", publishMeeting);

router.get("/api/webhooks", apiWebhooks);

router.get("/settings", settingsGet);

router.get("*", catchAll);

export default router;

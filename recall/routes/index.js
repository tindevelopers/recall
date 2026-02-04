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
import webhooksAssemblyAi from "./webhooks/assemblyai.js";
import notionTarget from "./integrations/notion-target.js";
import slackTarget from "./integrations/slack-target.js";
import teamworkTarget from "./integrations/teamwork-target.js";
import slackConnect from "./oauth/slack-connect.js";
import oauthCallbackSlack from "./oauth-callback/slack.js";
import apiChatMeetings from "./api/chat/meetings.js";
import apiNotionPages, { getNotionPageDetails } from "./api/notion-pages.js";
import apiCheckBot from "./api/check-bot.js";
import apiDebugCalendars from "./api/debug-calendars.js";
import apiDebugBotConfig from "./api/debug-bot-config.js";
import apiDebugWebhooks from "./api/debug-webhooks.js";
import apiDebugBotScheduling from "./api/debug-bot-scheduling.js";
import apiDiagnoseBotScheduling from "./api/diagnose-bot-scheduling.js";
import apiTriggerCalendarSync from "./api/trigger-calendar-sync.js";
import apiTriggerTeamsIngest from "./api/trigger-teams-ingest.js";
import apiTestWebhook from "./api/test-webhook.js";
import apiCheckMeetingPayload from "./api/check-meeting-payload.js";
import apiUpdateWebhookUrl from "./api/update-webhook-url.js";
import meetingsList from "./meetings/list.js";
import meetingsDetail from "./meetings/detail.js";
import meetingsShared from "./meetings/shared.js";
import meetingsUpdateTranscriptionMode from "./meetings/update-transcription-mode.js";
import {
  getMeetingMetadata,
  getTranscript,
  getSummary,
  getActionItems,
  triggerEnrichment,
  triggerSuperAgentAnalysis,
  getSuperAgentAnalysis,
} from "./api/meeting-details.js";
import refreshRecording from "./api/refresh-recording.js";
import getRecording from "./api/get-recording.js";
import publishMeeting from "./api/publish-meeting.js";
import { listDestinations as apiNotionDestinations, publishToNotionDestination } from "./api/notion-destinations.js";
import settingsGet from "./settings/get.js";
import profileUpdate from "./profile/update.js";
import apiWebhooks from "./api/webhooks.js";
import meetingSharesRouter from "./api/meeting-shares.js";
import recordingProxyRouter from "./api/recording-proxy.js";

const fallbackRoute = (featureName) => (req, res) =>
  res.status(503).json({ error: `${featureName} is temporarily unavailable` });

async function loadRouteModule(modulePath, featureName) {
  try {
    const module = await import(modulePath);
    if (module?.default) {
      return module.default;
    }
    console.warn(`[routes/index.js] ${featureName} loaded but has no default export`);
  } catch (error) {
    console.warn(`[routes/index.js] ${featureName} disabled:`, error?.message || error);
  }
  return fallbackRoute(featureName);
}

const router = Router();

const slackChannels = await loadRouteModule(
  "./api/slack-channels.js",
  "Slack channels API"
);
const slackChannelsCreate = await loadRouteModule(
  "./api/slack-channels-create.js",
  "Slack channel creation API"
);
const publishSlack = await loadRouteModule(
  "./api/publish-slack.js",
  "Slack publish API"
);
const publishingTargetsGet = await loadRouteModule(
  "./publishing-targets/get.js",
  "Publishing targets page"
);
const apiSlackChannels = slackChannels;

router.get("/", root);
router.get("/publishing-targets", publishingTargetsGet);

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
router.get("/oauth/slack", slackConnect);
router.get("/oauth-callback/slack", oauthCallbackSlack);

router.all("/webhooks/recall-calendar-updates", webhooksRecallCalendarUpdates);
router.post("/webhooks/recall-notes", webhooksRecallNotes);
router.post("/webhooks/assemblyai", webhooksAssemblyAi);

router.post("/integrations/notion-target", notionTarget);
router.post("/integrations/slack-target", slackTarget);
router.post("/integrations/teamwork-target", teamworkTarget);
router.get("/api/slack/channels", slackChannels);
router.post("/api/slack/channels", slackChannelsCreate);
router.post("/api/meetings/:meetingId/publish/slack", publishSlack);
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
router.post("/api/trigger-teams-ingest", apiTriggerTeamsIngest);
router.post("/api/test-webhook", apiTestWebhook);
router.get("/api/check-meeting-payload", apiCheckMeetingPayload);
router.post("/api/update-webhook-url", apiUpdateWebhookUrl);
router.get("/api/slack/channels", apiSlackChannels);

router.get("/meetings", meetingsList);
router.get("/meetings/shared/:token", meetingsShared);
router.get("/meetings/:id", meetingsDetail);
router.post("/meetings/:eventId/transcription-mode", meetingsUpdateTranscriptionMode);

// Meeting details API for lazy-loading
router.get("/api/meetings/:meetingId/metadata", getMeetingMetadata);
router.get("/api/meetings/:meetingId/transcript", getTranscript);
router.get("/api/meetings/:meetingId/summary", getSummary);
router.get("/api/meetings/:meetingId/actions", getActionItems);
router.post("/api/meetings/enrich", triggerEnrichment);
router.post("/api/meetings/:meetingId/super-agent/analyze", triggerSuperAgentAnalysis);
router.get("/api/meetings/:meetingId/super-agent", getSuperAgentAnalysis);
router.get("/api/meetings/:meetingId/recording", getRecording);
router.post("/api/meetings/:meetingId/refresh-recording", refreshRecording);
router.post("/api/meetings/:meetingId/publish", publishMeeting);
router.get("/api/notion/destinations", apiNotionDestinations);
router.post("/api/meetings/:meetingId/publish/notion", publishToNotionDestination);

router.get("/api/webhooks", apiWebhooks);

// Meeting sharing API
router.use("/api", meetingSharesRouter);
// Recording proxy/URL API
router.use("/api", recordingProxyRouter);

router.get("/settings", settingsGet);
router.post("/profile", profileUpdate);

router.get("*", catchAll);

export default router;

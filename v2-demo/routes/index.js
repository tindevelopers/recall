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
router.post("/calendar/:id/refresh", calendarRefresh);

router.patch("/calendar-event/:id/set-manual-record", calendarEventSetManualRecord);

router.get("/oauth-callback/google-calendar", oauthCallbackGoogleCalendar);
router.get("/oauth-callback/microsoft-outlook", oauthCallbackMicrosoftOutlook);
router.get("/oauth/notion", notionConnect);
router.get("/oauth-callback/notion", oauthCallbackNotion);

router.post("/webhooks/recall-calendar-updates", webhooksRecallCalendarUpdates);
router.post("/webhooks/recall-notes", webhooksRecallNotes);

router.post("/integrations/notion-target", notionTarget);
router.post("/api/chat/meetings", apiChatMeetings);

router.get("*", catchAll);

export default router;

import { generateNotice } from "./utils.js";
import {
  buildGoogleCalendarOAuthUrl,
  buildMicrosoftOutlookOAuthUrl,
} from "../logic/oauth.js";
import { buildNotionOAuthUrl } from "../logic/notion-oauth.js";

export default async (req, res) => {
  if (req.authenticated) {
    const calendars = await req.authentication.user.getCalendars();    
    const notionIntegration = await req.authentication.user.getIntegrations({
      where: { provider: "notion" },
      limit: 1,
    });
    const notionTarget = await req.authentication.user.getPublishTargets({
      where: { type: "notion" },
      limit: 1,
    });
    return res.render("index.ejs", {
      notice: req.notice,
      user: req.authentication.user,
      calendars,
      notion: {
        integration: notionIntegration?.[0] || null,
        target: notionTarget?.[0] || null,
      },
      connectUrls: {
        googleCalendar: buildGoogleCalendarOAuthUrl({
          userId: req.authentication.user.id,
        }),
        microsoftOutlook: buildMicrosoftOutlookOAuthUrl({
          userId: req.authentication.user.id,
        }),
        notion: buildNotionOAuthUrl({ userId: req.authentication.user.id }),
      },
    });
  } else {
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice("error", "You must be signed in to proceed.")
      )
    );
    return res.redirect("/sign-in");
  }
};

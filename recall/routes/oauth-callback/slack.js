import db from "../../db.js";
import { exchangeSlackCodeForToken } from "../../logic/slack-oauth.js";
import { generateNotice } from "../utils.js";

export default async (req, res) => {
  try {
    const { state, code } = req.query;
    const parsedState = state ? JSON.parse(state) : {};
    const userId = parsedState.userId;

    if (!userId) {
      throw new Error("Missing userId in Slack OAuth state");
    }
    if (!code) {
      throw new Error("Missing Slack OAuth code");
    }

    const tokenResponse = await exchangeSlackCodeForToken(code);
    const accessToken = tokenResponse?.access_token;
    const authedTeam = tokenResponse?.team || {};
    const botUserId = tokenResponse?.bot_user_id;

    if (!accessToken) {
      throw new Error("Slack OAuth did not return an access token");
    }

    await db.Integration.upsert({
      id: authedTeam.id || botUserId || userId,
      userId,
      provider: "slack",
      accessToken,
      refreshToken: null,
      config: {
        teamId: authedTeam.id,
        teamName: authedTeam.name,
        botUserId,
        scope: tokenResponse?.scope,
      },
    });

    res.cookie(
      "notice",
      JSON.stringify(generateNotice("success", "Connected Slack successfully."))
    );
    return res.redirect("/publishing-targets" || "/");
  } catch (err) {
    console.error("[ERROR] Slack OAuth callback failed:", err);
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "error",
          `Failed to connect Slack: ${err.message || "unknown error"}`
        )
      )
    );
    return res.redirect("/");
  }
};

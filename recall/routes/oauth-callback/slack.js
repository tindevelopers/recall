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

import fetch from "node-fetch";
import db from "../../db.js";
import { v4 as uuidv4 } from "uuid";

export default async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`Slack auth error: ${error}`);
  }
  if (!code) {
    return res.status(400).send("Missing code");
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send("Slack OAuth not configured");
  }

  try {
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.ok) {
      throw new Error(tokenJson.error || "Slack OAuth failed");
    }

    // Store integration
    const userId = req.authentication?.user?.id;
    if (!userId) {
      return res.status(401).send("Unauthorized");
    }

    const botToken = tokenJson.access_token;
    const team = tokenJson.team || {};

    await db.Integration.upsert({
      id: uuidv4(),
      userId,
      provider: "slack",
      accessToken: botToken,
      refreshToken: null,
      expiresAt: null,
      config: {
        teamId: team.id,
        teamName: team.name,
        authedUserId: tokenJson.authed_user?.id,
        botUserId: tokenJson.bot_user_id,
      },
    });

    res.cookie(
      "notice",
      JSON.stringify({
        type: "success",
        message: "Slack connected",
      })
    );
    return res.redirect("/publishing-targets");
  } catch (err) {
    console.error("[Slack OAuth] error", err);
    return res.status(500).send(err.message || "Slack OAuth failed");
  }
};



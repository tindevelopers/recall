import db from "../../db.js";
import { exchangeNotionCodeForToken } from "../../logic/notion-oauth.js";
import { generateNotice } from "../utils.js";

export default async (req, res) => {
  try {
    const { state, code } = req.query;
    const parsedState = state ? JSON.parse(state) : {};
    const userId = parsedState.userId;

    if (!userId) {
      throw new Error("Missing userId in Notion OAuth state");
    }

    const tokenResponse = await exchangeNotionCodeForToken(code);

    const accessToken = tokenResponse?.access_token;
    const refreshToken = tokenResponse?.refresh_token || null;
    const botId = tokenResponse?.bot_id;
    const workspaceId = tokenResponse?.workspace_id;

    await db.Integration.upsert({
      id: botId || workspaceId || userId,
      userId,
      provider: "notion",
      accessToken,
      refreshToken,
      config: {
        botId,
        workspaceId,
      },
    });

    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice("success", "Connected Notion successfully.")
      )
    );
    return res.redirect("/");
  } catch (err) {
    console.error("[ERROR] Notion OAuth callback failed:", err);
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "error",
          `Failed to connect Notion: ${err.message || "unknown error"}`
        )
      )
    );
    return res.redirect("/");
  }
};



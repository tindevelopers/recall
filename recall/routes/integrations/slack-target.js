import db from "../../db.js";
import { generateNotice } from "../utils.js";
import { v4 as uuidv4 } from "uuid";

export default async (req, res) => {
  if (!req.authenticated) {
    res.cookie(
      "notice",
      JSON.stringify(generateNotice("error", "You must be signed in."))
    );
    return res.redirect("/sign-in");
  }

  try {
    const { channelId, channelName, enabled } = req.body;
    if (!channelId) {
      throw new Error("Slack channel is required");
    }

    const userId = req.authentication.user.id;
    const [target, created] = await db.PublishTarget.upsert(
      {
        id: uuidv4(),
        userId,
        type: "slack",
        enabled: enabled === "on" || enabled === true,
        config: {
          channelId,
          channelName,
        },
      },
      { returning: true }
    );

    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "success",
          created ? "Slack target saved." : "Slack target updated."
        )
      )
    );
    return res.redirect("/");
  } catch (err) {
    console.error("[ERROR] Failed to save Slack publish target:", err);
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "error",
          `Failed to save Slack target: ${err.message || "unknown error"}`
        )
      )
    );
    return res.redirect("/");
  }
};



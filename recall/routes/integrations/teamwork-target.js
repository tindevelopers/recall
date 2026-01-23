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
    const { baseUrl, apiKey, projectId, tasklistId, milestoneId, enabled } = req.body;
    if (!baseUrl || !apiKey) {
      throw new Error("Teamwork base URL and API key are required");
    }

    const userId = req.authentication.user.id;
    const [target, created] = await db.PublishTarget.upsert(
      {
        id: uuidv4(),
        userId,
        type: "teamwork",
        enabled: enabled === "on" || enabled === true,
        config: {
          baseUrl,
          apiKey,
          projectId: projectId || null,
          tasklistId: tasklistId || null,
          milestoneId: milestoneId || null,
        },
      },
      { returning: true }
    );

    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "success",
          created ? "Teamwork target saved." : "Teamwork target updated."
        )
      )
    );
    return res.redirect("/");
  } catch (err) {
    console.error("[ERROR] Failed to save Teamwork publish target:", err);
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "error",
          `Failed to save Teamwork target: ${err.message || "unknown error"}`
        )
      )
    );
    return res.redirect("/");
  }
};



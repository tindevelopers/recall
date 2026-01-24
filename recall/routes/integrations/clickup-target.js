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
    const { token, teamId, spaceId, folderId, listId, enabled } = req.body;
    if (!token) {
      throw new Error("ClickUp token is required");
    }

    const userId = req.authentication.user.id;
    const [target, created] = await db.PublishTarget.upsert(
      {
        id: uuidv4(),
        userId,
        type: "clickup",
        enabled: enabled === "on" || enabled === true,
        config: {
          token,
          teamId,
          spaceId,
          folderId,
          listId,
        },
      },
      { returning: true }
    );

    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "success",
          created ? "ClickUp target saved." : "ClickUp target updated."
        )
      )
    );
    return res.redirect("/");
  } catch (err) {
    console.error("[ERROR] Failed to save ClickUp publish target:", err);
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "error",
          `Failed to save ClickUp target: ${err.message || "unknown error"}`
        )
      )
    );
    return res.redirect("/");
  }
};



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
    const { destinationId, destinationType = "database", enabled } = req.body;
    if (!destinationId) {
      throw new Error("Destination ID is required");
    }

    const userId = req.authentication.user.id;
    const [target, created] = await db.PublishTarget.upsert(
      {
        id: uuidv4(),
        userId,
        type: "notion",
        enabled: enabled === "on" || enabled === true,
        config: {
          destinationId,
          destinationType,
        },
      },
      { returning: true }
    );

    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "success",
          created ? "Notion target saved." : "Notion target updated."
        )
      )
    );
    return res.redirect("/");
  } catch (err) {
    console.error("[ERROR] Failed to save Notion publish target:", err);
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice(
          "error",
          `Failed to save Notion target: ${err.message || "unknown error"}`
        )
      )
    );
    return res.redirect("/");
  }
};



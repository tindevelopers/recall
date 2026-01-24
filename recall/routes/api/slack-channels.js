import db from "../../db.js";
import { listConversations } from "../../services/slack/web-api-client.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const userId = req.authentication.user.id;
    const integration = await db.Integration.findOne({
      where: { userId, provider: "slack" },
    });
    if (!integration?.accessToken) {
      return res.status(400).json({ error: "Slack is not connected" });
    }

    const data = await listConversations({ token: integration.accessToken });
    const channels =
      data.channels?.map((c) => ({
        id: c.id,
        name: c.name,
        isPrivate: c.is_private,
      })) || [];

    return res.json({ channels });
  } catch (err) {
    console.error("[API] slack-channels error:", err);
    return res.status(500).json({ error: "Failed to list Slack channels", message: err.message });
  }
};

import db from "../../db.js";
import { listConversations } from "../../services/slack/web-api-client.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const userId = req.authentication.user.id;

  try {
    const integration = await db.Integration.findOne({
      where: { userId, provider: "slack" },
    });
    if (!integration) {
      return res.status(400).json({ error: "Slack not connected" });
    }

    const token = integration.accessToken;
    const resp = await listConversations(token);
    const channels = (resp.channels || []).map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: c.is_private,
    }));
    return res.json({ channels });
  } catch (err) {
    console.error("[API] slack-channels error", err);
    return res.status(500).json({ error: err.message || "Failed to list channels" });
  }
};



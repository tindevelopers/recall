import db from "../../db.js";
import { createConversation, listUsers, inviteUsers } from "../../services/slack/web-api-client.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const userId = req.authentication.user.id;
  const { name, isPrivate, inviteAll } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Channel name is required" });
  }

  try {
    const integration = await db.Integration.findOne({
      where: { userId, provider: "slack" },
    });
    if (!integration) {
      return res.status(400).json({ error: "Slack not connected" });
    }

    const token = integration.accessToken;
    const created = await createConversation(token, {
      name,
      isPrivate: isPrivate === true || isPrivate === "true",
    });

    let invitedCount = 0;
    if (inviteAll) {
      const usersResp = await listUsers(token, { limit: 200 });
      const userIds = (usersResp.members || [])
        .filter((u) => !u.is_bot && !u.deleted && u.id)
        .map((u) => u.id);
      if (userIds.length) {
        await inviteUsers(token, { channel: created.channel.id, users: userIds.join(",") });
        invitedCount = userIds.length;
      }
    }

    return res.json({
      channel: {
        id: created.channel.id,
        name: created.channel.name,
        isPrivate: created.channel.is_private,
      },
      invitedCount,
    });
  } catch (err) {
    console.error("[API] slack-channels-create error", err);
    return res.status(500).json({ error: err.message || "Failed to create channel" });
  }
};



import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { createConversation, listUsers, inviteUsers } from "../../services/slack/web-api-client.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const userId = req.authentication.user.id;
  const { meetingId } = req.params;
  const { channelId, channelName, createChannelName, isPrivate, inviteAll } = req.body;

  try {
    const integration = await db.Integration.findOne({
      where: { userId, provider: "slack" },
    });
    if (!integration?.accessToken) {
      return res.status(400).json({ error: "Slack not connected" });
    }

    // Ensure summary exists
    const summary = await db.MeetingSummary.findOne({
      where: { meetingArtifactId: meetingId },
      order: [["createdAt", "DESC"]],
    });
    if (!summary) {
      return res.status(404).json({ error: "Meeting summary not found" });
    }

    let finalChannelId = channelId;
    let finalChannelName = channelName;

    // Create channel if requested
    if (!finalChannelId && createChannelName) {
      const created = await createConversation(integration.accessToken, {
        name: createChannelName,
        isPrivate: isPrivate === true || isPrivate === "true",
      });
      finalChannelId = created.channel.id;
      finalChannelName = created.channel.name;

      if (inviteAll) {
        const usersResp = await listUsers(integration.accessToken, { limit: 500 });
        const userIds = (usersResp.members || [])
          .filter((u) => !u.is_bot && !u.deleted && u.id)
          .map((u) => u.id);
        if (userIds.length) {
          await inviteUsers(integration.accessToken, {
            channel: finalChannelId,
            users: userIds.join(","),
          });
        }
      }
    }

    if (!finalChannelId) {
      return res.status(400).json({ error: "channelId is required" });
    }

    await backgroundQueue.add("publishing.dispatch", {
      meetingSummaryId: summary.id,
      slackOverride: {
        channelId: finalChannelId,
        channelName: finalChannelName,
      },
    });

    return res.json({
      success: true,
      channelId: finalChannelId,
      channelName: finalChannelName,
    });
  } catch (err) {
    console.error("[API] publish-slack error", err);
    return res.status(500).json({ error: err.message || "Failed to publish to Slack" });
  }
};



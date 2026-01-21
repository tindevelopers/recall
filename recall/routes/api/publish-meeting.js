import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { Op } from "sequelize";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;

  try {
    // Check if Notion integration exists
    const notionIntegration = await db.Integration.findOne({
      where: { userId, provider: "notion" },
    });

    if (!notionIntegration) {
      return res.status(400).json({
        success: false,
        error: "Notion not connected",
        message: "Please connect your Notion account in Settings first.",
      });
    }

    // Check if Notion target is configured
    const notionTarget = await db.PublishTarget.findOne({
      where: { userId, type: "notion", enabled: true },
    });

    if (!notionTarget) {
      return res.status(400).json({
        success: false,
        error: "Notion destination not configured",
        message: "Please configure a Notion destination in Settings first.",
      });
    }

    // Find the meeting artifact - support both UUID and readableId
    const artifact = await db.MeetingArtifact.findOne({
      where: {
        userId,
        [Op.or]: [
          { id: meetingId },
          { readableId: meetingId }
        ],
      },
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Check for an existing summary
    const summary = await db.MeetingSummary.findOne({
      where: { meetingArtifactId: artifact.id },
      order: [["createdAt", "DESC"]],
    });

    if (summary) {
      await backgroundQueue.add("publishing.dispatch", {
        meetingSummaryId: summary.id,
      });
      return res.json({
        success: true,
        action: "publish",
        message: "Publish job queued",
      });
    }

    // No summary yet - queue enrichment first
    await backgroundQueue.add("meeting.enrich", {
      meetingArtifactId: artifact.id,
    });

    return res.json({
      success: true,
      action: "enrich_then_publish",
      message: "Summary generation queued; will publish when ready",
    });
  } catch (err) {
    console.error("[API] publish-meeting error", err);
    return res.status(500).json({ error: "Failed to queue publish", detail: err.message });
  }
};



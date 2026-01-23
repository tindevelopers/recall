/**
 * API endpoints for Notion destination management
 * 
 * GET /api/notion/destinations - List available Notion pages and databases
 * POST /api/meetings/:meetingId/publish/notion - Publish to a specific Notion destination
 */

import db from "../../db.js";
import { searchPagesAndDatabases, getPageOrDatabase } from "../../services/notion/api-client.js";
import { backgroundQueue } from "../../queue.js";
import { Op } from "sequelize";

/**
 * GET /api/notion/destinations
 * Returns list of Notion pages and databases the user has access to
 */
export async function listDestinations(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = req.authentication.user.id;
  const query = req.query.q || "";

  try {
    // Get Notion integration
    const integration = await db.Integration.findOne({
      where: { userId, provider: "notion" },
    });

    if (!integration?.accessToken) {
      return res.status(400).json({
        error: "Notion not connected",
        message: "Please connect your Notion account first.",
      });
    }

    // Search for pages and databases
    const destinations = await searchPagesAndDatabases({
      accessToken: integration.accessToken,
      query,
    });

    // Get the current default destination
    const defaultTarget = await db.PublishTarget.findOne({
      where: { userId, type: "notion", enabled: true },
    });

    return res.json({
      destinations,
      defaultDestinationId: defaultTarget?.config?.destinationId || null,
    });
  } catch (err) {
    console.error("[API] notion-destinations error:", err);
    return res.status(500).json({
      error: "Failed to fetch Notion destinations",
      message: err.message,
    });
  }
}

/**
 * POST /api/meetings/:meetingId/publish/notion
 * Publish a meeting to a specific Notion destination
 * 
 * Body:
 * - destinationId: string (required) - Notion page or database ID
 * - destinationType: "page" | "database" (optional, auto-detected if not provided)
 * - createNewPage: boolean (optional) - If true and destination is a database, create a new page
 * - titleTemplate: string (optional) - Custom title to use for the created page/subpage
 */
export async function publishToNotionDestination(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const { destinationId, destinationType, createNewPage, titleTemplate } = req.body;
  const userId = req.authentication.user.id;

  if (!destinationId) {
    return res.status(400).json({
      error: "Missing destinationId",
      message: "Please select a Notion destination.",
    });
  }

  try {
    // Get Notion integration
    const integration = await db.Integration.findOne({
      where: { userId, provider: "notion" },
    });

    if (!integration?.accessToken) {
      return res.status(400).json({
        error: "Notion not connected",
        message: "Please connect your Notion account first.",
      });
    }

    // Validate the destination exists and is accessible
    const destinationInfo = await getPageOrDatabase({
      accessToken: integration.accessToken,
      id: destinationId,
    });

    if (!destinationInfo) {
      return res.status(400).json({
        error: "Invalid destination",
        message: "The selected Notion destination is not accessible.",
      });
    }

    // Find the meeting artifact
    const artifact = await db.MeetingArtifact.findOne({
      where: {
        [Op.or]: [{ id: meetingId }, { readableId: meetingId }],
        [Op.or]: [{ userId }, { ownerUserId: userId }],
      },
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Find or create meeting summary
    let summary = await db.MeetingSummary.findOne({
      where: { meetingArtifactId: artifact.id },
      order: [["createdAt", "DESC"]],
    });

    if (!summary) {
      // Queue enrichment first, then publish
      await backgroundQueue.add("meeting.enrich", {
        meetingArtifactId: artifact.id,
        publishAfterEnrich: true,
        notionOverride: {
          destinationId,
          destinationType: destinationType || destinationInfo.type,
          createNewPage: createNewPage || false,
          titleTemplate: titleTemplate || null,
        },
      });

      return res.json({
        success: true,
        action: "enrich_then_publish",
        message: "Generating summary first, will publish to Notion when ready.",
        destination: destinationInfo,
      });
    }

    // Queue the publish job with the specific destination override
    await backgroundQueue.add("publishing.dispatch", {
      meetingSummaryId: summary.id,
      notionOverride: {
        destinationId,
        destinationType: destinationType || destinationInfo.type,
        createNewPage: createNewPage || false,
        titleTemplate: titleTemplate || null,
      },
    });

    return res.json({
      success: true,
      action: "publish",
      message: `Publishing to "${destinationInfo.title}"...`,
      destination: destinationInfo,
    });
  } catch (err) {
    console.error("[API] publish-to-notion error:", err);
    return res.status(500).json({
      error: "Failed to publish to Notion",
      message: err.message,
    });
  }
}


import db from "../../db.js";
import { getPublisher } from "../../publishing/publisher-registry.js";
import { v4 as uuidv4 } from "uuid";

export default async (job) => {
  const { meetingSummaryId, notionOverride, slackOverride } = job.data;
  console.log(`[PUBLISHING] Starting publishing dispatch for meetingSummary ${meetingSummaryId}`);
  
  if (notionOverride) {
    console.log(`[PUBLISHING] Notion override provided:`, {
      destinationId: notionOverride.destinationId?.substring(0, 8) + "...",
      destinationType: notionOverride.destinationType,
      createNewPage: notionOverride.createNewPage,
      titleTemplate: notionOverride.titleTemplate ? `${notionOverride.titleTemplate.substring(0,30)}...` : null,
    });
  }

  if (slackOverride) {
    await publishToSlackWithOverride(meetingSummary, userId, slackOverride);
    console.log(`[PUBLISHING] Completed Slack-only publishing dispatch for meetingSummary ${meetingSummaryId}`);
    return;
  }
  
  const meetingSummary = await db.MeetingSummary.findByPk(meetingSummaryId, {
    include: [{ model: db.MeetingArtifact }],
  });

  if (!meetingSummary) {
    console.warn(
      `WARN: publishing.dispatch could not find meetingSummary ${meetingSummaryId}`
    );
    return;
  }

  const userId = meetingSummary.userId;
  if (!userId) {
    console.warn(
      `WARN: publishing.dispatch missing userId for meetingSummary ${meetingSummaryId}`
    );
    return;
  }

  // If notionOverride is provided, only publish to Notion with the override
  if (notionOverride) {
    await publishToNotionWithOverride(meetingSummary, userId, notionOverride);
    console.log(`[PUBLISHING] Completed Notion-only publishing dispatch for meetingSummary ${meetingSummaryId}`);
    return;
  }

  const targets = await db.PublishTarget.findAll({
    where: { userId, enabled: true },
  });
  
  console.log(`[PUBLISHING] Found ${targets.length} enabled publish target(s) for user ${userId}`);

  for (const target of targets) {
    console.log(`[PUBLISHING] Processing target ${target.type} (id: ${target.id})`);
    
    const publisher = getPublisher(target.type);
    if (!publisher) {
      console.warn(`WARN: No publisher found for type ${target.type}`);
      continue;
    }

    let delivery = await db.PublishDelivery.findOne({
      where: {
        meetingSummaryId: meetingSummary.id,
        publishTargetId: target.id,
      },
    });
    if (!delivery) {
      delivery = await db.PublishDelivery.create({
        id: uuidv4(),
        meetingSummaryId: meetingSummary.id,
        publishTargetId: target.id,
        status: "pending",
        attempts: 0,
      });
      console.log(`[PUBLISHING] Created new delivery record ${delivery.id}`);
    } else {
      console.log(`[PUBLISHING] Found existing delivery record ${delivery.id} (status: ${delivery.status}, attempts: ${delivery.attempts})`);
    }

    try {
      const integration = await db.Integration.findOne({
        where: { userId, provider: target.type },
      });
      if (!integration) {
        throw new Error(`Missing integration for provider ${target.type}`);
      }
      
      console.log(`[PUBLISHING] Found integration for ${target.type}, calling publisher...`);

      const result = await publisher.publish({
        meetingSummary,
        target,
        integration,
      });

      console.log(`[PUBLISHING] Successfully published to ${target.type}. Result:`, {
        externalId: result?.externalId,
        url: result?.url,
      });

      await delivery.update({
        status: "success",
        attempts: delivery.attempts + 1,
        externalId: result?.externalId || null,
        url: result?.url || null,
        lastError: null,
      });
      
      console.log(`[PUBLISHING] Updated delivery ${delivery.id} to success status`);
    } catch (err) {
      console.error(
        `[ERROR] Failed publishing meetingSummary ${meetingSummary.id} to target ${target.type}:`,
        err
      );
      console.error(`[ERROR] Error details:`, {
        message: err.message,
        stack: err.stack,
        name: err.name,
      });
      await delivery.update({
        status: "failed",
        attempts: delivery.attempts + 1,
        lastError: err.message || "unknown error",
      });
      console.log(`[PUBLISHING] Updated delivery ${delivery.id} to failed status`);
    }
  }
  
  console.log(`[PUBLISHING] Completed publishing dispatch for meetingSummary ${meetingSummaryId}`);
};

/**
 * Publish to Notion with a specific destination override
 */
async function publishToNotionWithOverride(meetingSummary, userId, notionOverride) {
  const publisher = getPublisher("notion");
  if (!publisher) {
    console.error(`[PUBLISHING] No Notion publisher found`);
    return;
  }

  const integration = await db.Integration.findOne({
    where: { userId, provider: "notion" },
  });
  
  if (!integration) {
    console.error(`[PUBLISHING] No Notion integration found for user ${userId}`);
    return;
  }

  // Create a virtual target with the override config
  const virtualTarget = {
    id: `notion-override-${Date.now()}`,
    type: "notion",
    config: {
      destinationId: notionOverride.destinationId,
      destinationType: notionOverride.destinationType || "database",
      createNewPage: notionOverride.createNewPage || false,
      titleTemplate: notionOverride.titleTemplate || null,
    },
  };

  console.log(`[PUBLISHING] Publishing to Notion with override config:`, virtualTarget.config);

  try {
    const result = await publisher.publish({
      meetingSummary,
      target: virtualTarget,
      integration,
    });

    console.log(`[PUBLISHING] Successfully published to Notion (override). Result:`, {
      externalId: result?.externalId,
      url: result?.url,
    });

    // Create a delivery record for tracking (find or create a publish target for this destination)
    let target = await db.PublishTarget.findOne({
      where: {
        userId,
        type: "notion",
        "config.destinationId": notionOverride.destinationId,
      },
    });

    if (!target) {
      // Use the default Notion target if exists, otherwise skip delivery tracking
      target = await db.PublishTarget.findOne({
        where: { userId, type: "notion", enabled: true },
      });
    }

    if (target) {
      const delivery = await db.PublishDelivery.create({
        id: uuidv4(),
        meetingSummaryId: meetingSummary.id,
        publishTargetId: target.id,
        status: "success",
        attempts: 1,
        externalId: result?.externalId || null,
        url: result?.url || null,
      });
      console.log(`[PUBLISHING] Created delivery record ${delivery.id}`);
    }
  } catch (err) {
    console.error(`[ERROR] Failed publishing to Notion (override):`, err);
    throw err;
  }
}

async function publishToSlackWithOverride(meetingSummary, userId, slackOverride) {
  const publisher = getPublisher("slack");
  if (!publisher) {
    console.error(`[PUBLISHING] No Slack publisher found`);
    return;
  }

  const integration = await db.Integration.findOne({
    where: { userId, provider: "slack" },
  });

  if (!integration) {
    console.error(`[PUBLISHING] No Slack integration found for user ${userId}`);
    return;
  }

  // Create a virtual target with the override config
  const virtualTarget = {
    id: `slack-override-${Date.now()}`,
    type: "slack",
    config: {
      channelId: slackOverride.channelId,
      channelName: slackOverride.channelName,
    },
  };

  console.log(`[PUBLISHING] Publishing to Slack with override config:`, virtualTarget.config);

  try {
    await publisher.publish({
      meetingSummary,
      target: virtualTarget,
      integration,
    });
  } catch (err) {
    console.error(`[ERROR] Failed publishing to Slack (override):`, err);
    throw err;
  }
}



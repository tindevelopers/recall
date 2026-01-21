import db from "../../db.js";
import { getPublisher } from "../../publishing/publisher-registry.js";
import { v4 as uuidv4 } from "uuid";

export default async (job) => {
  const { meetingSummaryId } = job.data;
  console.log(`[PUBLISHING] Starting publishing dispatch for meetingSummary ${meetingSummaryId}`);
  
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

      const result = await publisher({
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



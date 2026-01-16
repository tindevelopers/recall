import db from "../../db.js";
import { getPublisher } from "../../publishing/publisher-registry.js";
import { v4 as uuidv4 } from "uuid";

export default async (job) => {
  const { meetingSummaryId } = job.data;
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

  for (const target of targets) {
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
    }

    try {
      const integration = await db.Integration.findOne({
        where: { userId, provider: target.type },
      });
      if (!integration) {
        throw new Error(`Missing integration for provider ${target.type}`);
      }

      const result = await publisher({
        meetingSummary,
        target,
        integration,
      });

      await delivery.update({
        status: "success",
        attempts: delivery.attempts + 1,
        externalId: result?.externalId || null,
        url: result?.url || null,
        lastError: null,
      });
    } catch (err) {
      console.error(
        `[ERROR] Failed publishing meetingSummary ${meetingSummary.id} to target ${target.type}:`,
        err
      );
      await delivery.update({
        status: "failed",
        attempts: delivery.attempts + 1,
        lastError: err.message || "unknown error",
      });
    }
  }
};



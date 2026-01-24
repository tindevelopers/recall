import { BasePublisher } from "../base-publisher.js";
import { normalizeMeetingData } from "../data-transformer.js";
import { createTask } from "../../services/clickup/api-client.js";

class ClickUpPublisher extends BasePublisher {
  constructor() {
    super({ name: "clickup" });
  }

  validateConfig(config) {
    if (!config?.token) throw new Error("ClickUp token is required");
    if (!config?.listId) throw new Error("ClickUp listId is required");
  }

  async transformData(meetingSummary) {
    return normalizeMeetingData(meetingSummary, { includeTranscript: false });
  }

  async send({ payload, target }) {
    const { token, listId } = target.config || {};

    const descriptionParts = [];
    if (payload.summary) descriptionParts.push(`Summary:\n${payload.summary}`);
    if (payload.metadata?.meetingUrl) descriptionParts.push(`Meeting URL: ${payload.metadata.meetingUrl}`);
    if (payload.metadata?.videoUrl) descriptionParts.push(`Recording (video): ${payload.metadata.videoUrl}`);
    if (payload.metadata?.audioUrl) descriptionParts.push(`Recording (audio): ${payload.metadata.audioUrl}`);

    const createdTasks = [];
    const createItems = [...(payload.actionItems || []), ...(payload.followUps || [])];
    if (createItems.length) {
      for (const item of createItems) {
        const name = typeof item === "string" ? item : item.description || item.text || "Action item";
        const task = await createTask(token, {
          listId,
          name,
          description: descriptionParts.join("\n\n"),
          milestone: false,
        });
        createdTasks.push(task);
      }
    } else {
      const task = await createTask(token, {
        listId,
        name: payload.title,
        description: descriptionParts.join("\n\n"),
        milestone: false,
      });
      createdTasks.push(task);
    }

    // milestone task using follow-ups summary
    if (payload.followUps?.length) {
      await createTask(token, {
        listId,
        name: `Milestone: Follow-ups for ${payload.title}`,
        description: payload.followUps.map((i, idx) => `${idx + 1}. ${i.description || i}`).join("\n"),
        milestone: true,
      });
    }

    const first = createdTasks[0];
    return {
      externalId: first?.id || null,
      url: first?.url || null,
    };
  }
}

const clickUpPublisher = new ClickUpPublisher();
export default clickUpPublisher;



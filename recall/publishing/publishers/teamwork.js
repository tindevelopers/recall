import { BasePublisher } from "../base-publisher.js";
import { normalizeMeetingData } from "../data-transformer.js";
import { createTask, createMilestone } from "../../services/teamwork/api-client.js";

class TeamworkPublisher extends BasePublisher {
  constructor() {
    super({ name: "teamwork" });
  }

  validateConfig(config) {
    if (!config?.baseUrl) {
      throw new Error("Teamwork baseUrl is required");
    }
    if (!config?.apiKey) {
      throw new Error("Teamwork apiKey is required");
    }
  }

  async transformData(meetingSummary) {
    return normalizeMeetingData(meetingSummary, { includeTranscript: false });
  }

  async send({ payload, target }) {
    const { baseUrl, apiKey, projectId, tasklistId, milestoneId } = target.config || {};
    const descriptionParts = [];
    if (payload.summary) descriptionParts.push(`Summary:\n${payload.summary}`);
    if (payload.metadata?.meetingUrl) descriptionParts.push(`Meeting URL: ${payload.metadata.meetingUrl}`);
    if (payload.metadata?.videoUrl) descriptionParts.push(`Recording (video): ${payload.metadata.videoUrl}`);
    if (payload.metadata?.audioUrl) descriptionParts.push(`Recording (audio): ${payload.metadata.audioUrl}`);

    // Optionally create a milestone for follow-ups
    let createdMilestone = null;
    if (payload.followUps?.length) {
      const milestoneTitle = `Follow-ups for ${payload.title}`;
      const milestoneDesc = payload.followUps.map((i, idx) => `${idx + 1}. ${i.description || i}`).join("\n");
      try {
        createdMilestone = await createMilestone({
          baseUrl,
          apiKey,
          projectId: projectId || milestoneId ? projectId : undefined,
          title: milestoneTitle,
          description: milestoneDesc,
        });
      } catch (e) {
        // milestone creation is best-effort; log and continue
        console.warn("[Teamwork] milestone creation failed", e.message);
      }
    }

    const createdTasks = [];
    const createItems = [...(payload.actionItems || []), ...(payload.followUps || [])];
    if (createItems.length) {
      for (const item of createItems) {
        const content = typeof item === "string" ? item : item.description || item.text || "Action item";
        const desc = descriptionParts.join("\n\n");
        const task = await createTask({
          baseUrl,
          apiKey,
          content,
          description: desc,
          tasklistId,
        });
        createdTasks.push(task);
      }
    } else {
      // fallback single task with summary if no items
      const task = await createTask({
        baseUrl,
        apiKey,
        content: payload.title,
        description: descriptionParts.join("\n\n"),
        tasklistId,
      });
      createdTasks.push(task);
    }

    const first = createdTasks[0];
    return {
      externalId: first?.["id"] || null,
      url: first?.["link"] || null,
    };
  }
}

const teamworkPublisher = new TeamworkPublisher();
export default teamworkPublisher;



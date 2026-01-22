import { BasePublisher } from "../base-publisher.js";
import { normalizeMeetingData } from "../data-transformer.js";
import { createTask } from "../../services/teamwork/api-client.js";

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
    const descriptionParts = [];
    if (payload.summary) descriptionParts.push(`Summary:\n${payload.summary}`);
    if (payload.actionItems?.length) {
      descriptionParts.push(
        `Action Items:\n${payload.actionItems
          .map((i, idx) => `${idx + 1}. ${i.description || i}`)
          .join("\n")}`
      );
    }
    if (payload.followUps?.length) {
      descriptionParts.push(
        `Follow Ups:\n${payload.followUps
          .map((i, idx) => `${idx + 1}. ${i.description || i}`)
          .join("\n")}`
      );
    }
    if (payload.metadata?.meetingUrl) {
      descriptionParts.push(`Meeting URL: ${payload.metadata.meetingUrl}`);
    }
    if (payload.metadata?.videoUrl) {
      descriptionParts.push(`Recording (video): ${payload.metadata.videoUrl}`);
    }
    if (payload.metadata?.audioUrl) {
      descriptionParts.push(`Recording (audio): ${payload.metadata.audioUrl}`);
    }

    const description = descriptionParts.join("\n\n");

    const result = await createTask({
      baseUrl: target.config.baseUrl,
      apiKey: target.config.apiKey,
      content: payload.title,
      description,
    });

    return {
      externalId: result?.["id"] || null,
      url: result?.["link"] || null,
    };
  }
}

const teamworkPublisher = new TeamworkPublisher();
export default teamworkPublisher;



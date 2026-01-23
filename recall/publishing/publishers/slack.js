import { BasePublisher } from "../base-publisher.js";
import { normalizeMeetingData } from "../data-transformer.js";
import { postMessage } from "../../services/slack/web-api-client.js";

class SlackPublisher extends BasePublisher {
  constructor() {
    super({ name: "slack" });
  }

  validateConfig(config) {
    if (!config?.webhookUrl) {
      throw new Error("Slack webhookUrl is required");
    }
  }

  async transformData(meetingSummary) {
    return normalizeMeetingData(meetingSummary);
  }

  buildBlocks(payload) {
    const blocks = [];

    // Header
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: payload.title },
    });

    // Summary
    if (payload.summary) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Summary*\n${payload.summary}`,
        },
      });
    }

    // Action items
    if (payload.actionItems?.length) {
      const list = payload.actionItems
        .map((item, idx) => `• ${item.description || item || `Item ${idx + 1}`}`)
        .join("\n");
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Action Items*\n${list}` },
      });
    }

    // Follow ups
    if (payload.followUps?.length) {
      const list = payload.followUps
        .map((item, idx) => `• ${item.description || item || `Item ${idx + 1}`}`)
        .join("\n");
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Follow Ups*\n${list}` },
      });
    }

    // Sentiment
    if (payload.sentimentLabel) {
      blocks.push({
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Sentiment*\n${payload.sentimentLabel} (${payload.sentimentScore ?? "n/a"})`,
          },
        ],
      });
    }

    // Metadata
    const meta = payload.metadata || {};
    const metaFields = [];
    if (meta.meetingDate) metaFields.push({ type: "mrkdwn", text: `*Date*\n${meta.meetingDate}` });
    if (meta.meetingTime) metaFields.push({ type: "mrkdwn", text: `*Time*\n${meta.meetingTime}` });
    if (meta.durationFormatted) metaFields.push({ type: "mrkdwn", text: `*Duration*\n${meta.durationFormatted}` });
    if (meta.attendeeNames) metaFields.push({ type: "mrkdwn", text: `*Attendees*\n${meta.attendeeNames}` });
    if (meta.platform) metaFields.push({ type: "mrkdwn", text: `*Platform*\n${meta.platform}` });
    if (meta.meetingUrl) metaFields.push({ type: "mrkdwn", text: `*Meeting URL*\n${meta.meetingUrl}` });
    if (meta.videoUrl) metaFields.push({ type: "mrkdwn", text: `*Video*\n${meta.videoUrl}` });
    if (meta.audioUrl) metaFields.push({ type: "mrkdwn", text: `*Audio*\n${meta.audioUrl}` });

    if (metaFields.length) {
      blocks.push({ type: "section", fields: metaFields });
    }

    // Transcript (optional, truncated)
    if (payload.transcriptText) {
      const truncated =
        payload.transcriptText.length > 3000
          ? payload.transcriptText.slice(0, 3000) + "\n…"
          : payload.transcriptText;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Transcript (truncated)*\n${truncated}` },
      });
    }

    blocks.push({ type: "divider" });
    return blocks;
  }

  async send({ payload, target, integration }) {
    if (!integration?.accessToken) {
      throw new Error("Slack not connected");
    }

    const channelId = target?.config?.channelId;
    if (!channelId) {
      throw new Error("Slack channel not configured");
    }

    const blocks = this.buildBlocks(payload);
    const resp = await postMessage(integration.accessToken, {
      channel: channelId,
      text: payload.title,
      blocks,
    });

    return {
      externalId: resp?.ts || null,
      url: resp?.channel ? `https://app.slack.com/client/${resp.channel}/${resp.ts}` : null,
    };
  }
}

const slackPublisher = new SlackPublisher();
export default slackPublisher;



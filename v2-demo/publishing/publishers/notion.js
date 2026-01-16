import {
  appendBlocksToPage,
  createPageInDatabase,
} from "../../services/notion/api-client.js";

function buildBlocks(meetingSummary) {
  const blocks = [];
  if (meetingSummary.summary) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Summary" } }] },
    });
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: meetingSummary.summary } }],
      },
    });
  }

  if (meetingSummary.actionItems?.length) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Action Items" } }] },
    });
    meetingSummary.actionItems.forEach((item) => {
      const text =
        typeof item === "string"
          ? item
          : item?.description || JSON.stringify(item);
      blocks.push({
        object: "block",
        type: "to_do",
        to_do: {
          checked: false,
          rich_text: [{ type: "text", text: { content: text } }],
        },
      });
    });
  }

  if (meetingSummary.followUps?.length) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Follow Ups" } }] },
    });
    meetingSummary.followUps.forEach((item) => {
      const text =
        typeof item === "string"
          ? item
          : item?.description || JSON.stringify(item);
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: text } }],
        },
      });
    });
  }

  if (meetingSummary.topics?.length) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: "Topics" } }] },
    });
    meetingSummary.topics.forEach((topic) => {
      const text =
        typeof topic === "string"
          ? topic
          : topic?.title || topic?.name || JSON.stringify(topic);
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: text } }],
        },
      });
    });
  }

  return blocks;
}

export default async function notionPublisher({
  meetingSummary,
  target,
  integration,
}) {
  if (!integration?.accessToken) {
    throw new Error("Missing Notion access token for user");
  }

  const config = target.config || {};
  const destinationType = config.destinationType || "database";
  const destinationId = config.destinationId;
  if (!destinationId) {
    throw new Error("Missing Notion destinationId in target config");
  }

  const title =
    config.titleTemplate ||
    meetingSummary.summary?.slice(0, 100) ||
    "Meeting Notes";
  const children = buildBlocks(meetingSummary);

  let result = null;
  if (destinationType === "database") {
    result = await createPageInDatabase({
      accessToken: integration.accessToken,
      databaseId: destinationId,
      title,
      children,
    });
    return {
      externalId: result?.id,
      url: result?.url,
    };
  }

  // default: append to page
  result = await appendBlocksToPage({
    accessToken: integration.accessToken,
    pageId: destinationId,
    children,
  });
  return {
    externalId: destinationId,
    url: `https://www.notion.so/${destinationId.replace(/-/g, "")}`,
  };
}



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
  console.log(`[NOTION] Starting Notion publisher for meetingSummary ${meetingSummary.id}`);
  
  if (!integration?.accessToken) {
    console.error(`[NOTION] Missing access token for user`);
    throw new Error("Missing Notion access token for user");
  }

  const config = target.config || {};
  const destinationType = config.destinationType || "database";
  const destinationId = config.destinationId;
  
  console.log(`[NOTION] Config:`, {
    destinationType,
    destinationId: destinationId ? `${destinationId.substring(0, 8)}...` : null,
    hasTitleTemplate: !!config.titleTemplate,
  });
  
  if (!destinationId) {
    console.error(`[NOTION] Missing destinationId in target config`);
    throw new Error("Missing Notion destinationId in target config");
  }

  const title =
    config.titleTemplate ||
    meetingSummary.summary?.slice(0, 100) ||
    "Meeting Notes";
  const children = buildBlocks(meetingSummary);
  
  console.log(`[NOTION] Built ${children.length} blocks, title: "${title.substring(0, 50)}..."`);

  let result = null;
  if (destinationType === "database") {
    console.log(`[NOTION] Creating page in database ${destinationId.substring(0, 8)}...`);
    try {
      result = await createPageInDatabase({
        accessToken: integration.accessToken,
        databaseId: destinationId,
        title,
        children,
      });
      console.log(`[NOTION] Successfully created page in database. Page ID: ${result?.id}, URL: ${result?.url}`);
      return {
        externalId: result?.id,
        url: result?.url,
      };
    } catch (err) {
      console.error(`[NOTION] Error creating page in database:`, {
        message: err.message,
        status: err.status,
        code: err.code,
        response: err.response?.data || err.body,
      });
      throw err;
    }
  }

  // default: append to page
  console.log(`[NOTION] Appending blocks to page ${destinationId.substring(0, 8)}...`);
  try {
    result = await appendBlocksToPage({
      accessToken: integration.accessToken,
      pageId: destinationId,
      children,
    });
    const url = `https://www.notion.so/${destinationId.replace(/-/g, "")}`;
    console.log(`[NOTION] Successfully appended blocks to page. URL: ${url}`);
    return {
      externalId: destinationId,
      url,
    };
  } catch (err) {
    console.error(`[NOTION] Error appending blocks to page:`, {
      message: err.message,
      status: err.status,
      code: err.code,
      response: err.response?.data || err.body,
    });
    throw err;
  }
}



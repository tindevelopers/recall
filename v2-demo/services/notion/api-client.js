import fetch from "node-fetch";

const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

function buildHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionRequest({ accessToken, path, method = "POST", body }) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: buildHeaders(accessToken),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Notion request failed (${res.status}) ${path}: ${text || "unknown"}`
    );
  }
  return await res.json();
}

export async function createPageInDatabase({
  accessToken,
  databaseId,
  title,
  children,
}) {
  return notionRequest({
    accessToken,
    path: "/pages",
    body: {
      parent: { database_id: databaseId },
      properties: {
        Name: {
          title: [
            {
              text: {
                content: title,
              },
            },
          ],
        },
      },
      children,
    },
  });
}

export async function appendBlocksToPage({ accessToken, pageId, children }) {
  return notionRequest({
    accessToken,
    path: `/blocks/${pageId}/children`,
    body: {
      children,
    },
  });
}



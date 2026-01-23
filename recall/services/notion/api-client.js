import fetch from "node-fetch";

const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";

function buildHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

function normalizeNotionId(id) {
  if (!id || typeof id !== "string") return id;
  return id.replace(/-/g, "");
}

async function notionRequest({ accessToken, path, method = "POST", body }) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: buildHeaders(accessToken),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(
      `Notion request failed (${res.status}) ${path}: ${text || "unknown"}`
    );
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return await res.json();
}

/**
 * Search for pages and databases the integration has access to
 */
export async function searchPagesAndDatabases({ accessToken, query = "" }) {
  const results = [];
  
  // Search for databases
  const databasesResponse = await notionRequest({
    accessToken,
    path: "/search",
    body: {
      query,
      filter: { property: "object", value: "database" },
      page_size: 50,
    },
  });
  
  for (const db of databasesResponse.results || []) {
    const title = db.title?.[0]?.plain_text || "Untitled Database";
    results.push({
      id: db.id,
      type: "database",
      title,
      icon: db.icon?.emoji || db.icon?.external?.url || "📊",
      url: db.url,
    });
  }
  
  // Search for pages
  const pagesResponse = await notionRequest({
    accessToken,
    path: "/search",
    body: {
      query,
      filter: { property: "object", value: "page" },
      page_size: 50,
    },
  });
  
  for (const page of pagesResponse.results || []) {
    // Get title from properties or child_page
    let title = "Untitled Page";
    if (page.properties?.title?.title?.[0]?.plain_text) {
      title = page.properties.title.title[0].plain_text;
    } else if (page.properties?.Name?.title?.[0]?.plain_text) {
      title = page.properties.Name.title[0].plain_text;
    } else if (page.child_page?.title) {
      title = page.child_page.title;
    }
    
    results.push({
      id: page.id,
      type: "page",
      title,
      icon: page.icon?.emoji || page.icon?.external?.url || "📄",
      url: page.url,
    });
  }
  
  return results;
}

/**
 * Get details about a specific page or database
 */
export async function getPageOrDatabase({ accessToken, id }) {
  try {
    // Try as database first
    const db = await notionRequest({
      accessToken,
      path: `/databases/${id}`,
      method: "GET",
    });
    return {
      id: db.id,
      type: "database",
      title: db.title?.[0]?.plain_text || "Untitled Database",
      icon: db.icon?.emoji || db.icon?.external?.url || "📊",
      url: db.url,
    };
  } catch (e) {
    // Try as page
    try {
      const page = await notionRequest({
        accessToken,
        path: `/pages/${id}`,
        method: "GET",
      });
      let title = "Untitled Page";
      if (page.properties?.title?.title?.[0]?.plain_text) {
        title = page.properties.title.title[0].plain_text;
      } else if (page.properties?.Name?.title?.[0]?.plain_text) {
        title = page.properties.Name.title[0].plain_text;
      }
      return {
        id: page.id,
        type: "page",
        title,
        icon: page.icon?.emoji || page.icon?.external?.url || "📄",
        url: page.url,
      };
    } catch (e2) {
      return null;
    }
  }
}

export async function createPageInDatabase({
  accessToken,
  databaseId,
  title,
  children,
}) {
  const dbId = normalizeNotionId(databaseId);
  return notionRequest({
    accessToken,
    path: "/pages",
    body: {
      parent: { database_id: dbId },
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

/**
 * Create a new subpage under an existing page
 */
export async function createSubpage({
  accessToken,
  parentPageId,
  title,
  children,
  icon,
}) {
  const pageId = normalizeNotionId(parentPageId);
  return notionRequest({
    accessToken,
    path: "/pages",
    body: {
      parent: { page_id: pageId },
      icon: icon ? { type: "emoji", emoji: icon } : { type: "emoji", emoji: "📝" },
      properties: {
        title: {
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
  const blockIdNormalized = normalizeNotionId(pageId);
  const blockIdHyphenated = pageId;
  
  // Try normalized ID first, then fall back to hyphenated if Notion rejects the URL
  const candidates = [blockIdNormalized, blockIdHyphenated].filter(Boolean);
  
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await notionRequest({
        accessToken,
        path: `/blocks/${candidate}/children`,
        method: "PATCH",
        body: {
          children,
        },
      });
    } catch (err) {
      lastError = err;
      // If Notion says invalid_request_url, try the next candidate
      let isInvalidUrl = false;
      if (err.status === 400) {
        // Check error message
        if (typeof err.message === "string" && err.message.toLowerCase().includes("invalid request url")) {
          isInvalidUrl = true;
        }
        // Also check error body JSON for code field
        if (err.body) {
          try {
            const errorBody = JSON.parse(err.body);
            if (errorBody.code === "invalid_request_url") {
              isInvalidUrl = true;
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }
      if (isInvalidUrl) {
        continue;
      }
      throw err;
    }
  }
  
  // If all attempts failed, throw the last error
  throw lastError;
}



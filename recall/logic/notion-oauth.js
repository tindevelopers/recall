import fetch from "node-fetch";

const NOTION_CLIENT_ID = process.env.NOTION_OAUTH_CLIENT_ID;
const NOTION_CLIENT_SECRET = process.env.NOTION_OAUTH_CLIENT_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL;

export function buildNotionOAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: NOTION_CLIENT_ID,
    response_type: "code",
    owner: "user",
    redirect_uri: `${PUBLIC_URL}/oauth-callback/notion`,
    state: JSON.stringify(state),
  });

  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

export async function exchangeNotionCodeForToken(code) {
  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: `${PUBLIC_URL}/oauth-callback/notion`,
  };

  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString(
          "base64"
        ),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Notion OAuth token exchange failed: ${res.status} ${
        json?.error || "unknown"
      }`
    );
  }
  return json;
}



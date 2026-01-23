import fetch from "node-fetch";

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const SLACK_REDIRECT_URI =
  process.env.SLACK_REDIRECT_URI ||
  `${process.env.APP_BASE_URL || "http://localhost:3003"}/oauth-callback/slack`;

// Scopes: channel read/create, invite, user list, post messages
const SLACK_SCOPES = [
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "channels:manage",
  "groups:write",
  "users:read",
  "chat:write",
].join(" ");

export function buildSlackOAuthUrl({ userId }) {
  if (!SLACK_CLIENT_ID) {
    throw new Error("Missing SLACK_CLIENT_ID");
  }
  const state = encodeURIComponent(JSON.stringify({ userId }));
  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    scope: SLACK_SCOPES,
    user_scope: "",
    redirect_uri: SLACK_REDIRECT_URI,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackCodeForToken(code) {
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    throw new Error("Missing Slack client id/secret");
  }
  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    client_secret: SLACK_CLIENT_SECRET,
    code,
    redirect_uri: SLACK_REDIRECT_URI,
  });

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const body = await res.json();
  if (!body.ok) {
    throw new Error(body.error || "Slack OAuth exchange failed");
  }
  return body;
}



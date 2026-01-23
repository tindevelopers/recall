import { buildSlackOAuthUrl } from "../../logic/slack-oauth.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }
  const url = buildSlackOAuthUrl({ userId: req.authentication.user.id });
  return res.redirect(url);
};

export default async (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(500).send("Slack OAuth not configured");
  }

  const scopes = [
    "chat:write",
    "channels:read",
    "channels:manage",
    "groups:read",
    "groups:write",
    "users:read",
  ];

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", ""); // optional; could add CSRF token

  return res.redirect(url.toString());
};



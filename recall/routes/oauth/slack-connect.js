import { buildSlackOAuthUrl } from "../../logic/slack-oauth.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const url = buildSlackOAuthUrl({ userId: req.authentication.user.id });
  return res.redirect(url);
};

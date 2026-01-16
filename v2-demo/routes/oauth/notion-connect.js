import { buildNotionOAuthUrl } from "../../logic/notion-oauth.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }
  const url = buildNotionOAuthUrl({ userId: req.authentication.user.id });
  return res.redirect(url);
};



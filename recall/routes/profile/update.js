import db from "../../db.js";
import { generateNotice } from "../utils.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.cookie("notice", JSON.stringify(generateNotice("error", "Name is required")), {
      httpOnly: false,
      maxAge: 5000,
    });
    return res.redirect("/settings#user");
  }

  const user = await db.User.findByPk(req.authentication.user.id);
  if (!user) {
    return res.redirect("/sign-in");
  }

  user.name = name;
  await user.save();

  res.cookie("notice", JSON.stringify(generateNotice("success", "Profile updated")), {
    httpOnly: false,
    maxAge: 5000,
  });
  return res.redirect("/settings#user");
};

import { getAuthTokenForUser } from "../../logic/auth.js";
import { generateNotice } from "../utils.js";
import db from "../../db.js";

export default async (req, res) => {
  const user = await db.User.findOne({
    where: {
      email: req.body.email,
      password: req.body.password,
    },
  });

  if (user) {
    res.cookie("authToken", getAuthTokenForUser(user), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    res.redirect("/");
  } else {
    res.clearCookie("notice");
    return res.render("signin.ejs", {
      notice: generateNotice("error", "Invalid email or password"),
    });
  }
};

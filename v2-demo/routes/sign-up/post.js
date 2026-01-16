import { getAuthTokenForUser } from "../../logic/auth.js";
import { generateNotice } from "../utils.js";
import db from "../../db.js";

export default async (req, res) => {
  try {
    const user = await db.User.create({
      email: req.body.email,
      password: req.body.password,
      name: req.body.name,
    });
    res.cookie("authToken", getAuthTokenForUser(user), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice("success", "Successfully signed up. Welcome!")
      )
    );
    return res.redirect("/");
  } catch (err) {
    res.clearCookie("notice");
    return res.render("signup.ejs", {
      notice: generateNotice(
        "error",
        `Failed to sign up due to ${err.message}`
      ),
    });
  }
};

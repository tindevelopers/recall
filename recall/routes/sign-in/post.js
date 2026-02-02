import { getAuthTokenForUser } from "../../logic/auth.js";
import { generateNotice } from "../utils.js";
import db from "../../db.js";

export default async (req, res) => {
  console.log(`[SIGNIN] Attempting login with email: ${req.body.email}`);

  // First find user by email to debug
  const userByEmail = await db.User.findOne({
    where: {
      email: req.body.email,
    },
  });

  if (userByEmail) {
    console.log(`[SIGNIN] User found: ${userByEmail.email}`);
    console.log(`[SIGNIN] Password match: ${userByEmail.password === req.body.password}`);
    console.log(`[SIGNIN] Submitted password: "${req.body.password}"`);
    console.log(`[SIGNIN] Stored password: "${userByEmail.password}"`);
    console.log(`[SIGNIN] Submitted password length: ${req.body.password?.length || 0}`);
    console.log(`[SIGNIN] Stored password length: ${userByEmail.password?.length || 0}`);
  } else {
    console.log(`[SIGNIN] No user found with email: ${req.body.email}`);
  }

  const user = await db.User.findOne({
    where: {
      email: req.body.email,
      password: req.body.password,
    },
  });

  if (user) {
    console.log(`[SIGNIN] ✅ Login successful for ${user.email}`);
    const token = getAuthTokenForUser(user);
    console.log(`[SIGNIN] Generated token: ${token.substring(0, 20)}...`);
    res.cookie("authToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    console.log(`[SIGNIN] Cookie set, redirecting to /`);
    return res.redirect("/");
  } else {
    console.log(`[SIGNIN] ❌ Login failed for ${req.body.email}`);
    res.clearCookie("notice");
    return res.render("signin.ejs", {
      notice: generateNotice("error", "Invalid email or password"),
    });
  }
};

import { generateNotice } from "../utils.js";

export default async (req, res) => {
  // Clear the auth token cookie
  res.clearCookie("authToken");
  
  // Set a success notice
  res.cookie(
    "notice",
    JSON.stringify(
      generateNotice("success", "You have been signed out successfully.")
    )
  );
  
  // Redirect to sign-in page
  return res.redirect("/sign-in");
};


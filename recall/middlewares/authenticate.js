import { getUserFromAuthToken } from "../logic/auth.js";

export default async function (req, res, next) {
  req.challenge = req.cookies.authToken;
  console.log(`[AUTH] Cookies received:`, Object.keys(req.cookies));
  if (req.cookies.authToken) {
    console.log(`[AUTH] authToken found: ${req.cookies.authToken.substring(0, 20)}...`);
  } else {
    console.log(`[AUTH] No authToken cookie found`);
  }

  let user = null;
  try {
    user = await getUserFromAuthToken(req.challenge);
  } catch (err) {}

  req.authenticated = Boolean(user);

  if (req.authenticated) {
    req.authentication = { user };
    console.log(`[AUTH] ✅ User authenticated: ${user.email}`);
  } else {
    req.authentication = { error: "INVALID_CREDENTIALS" };
    console.log(`[AUTH] ❌ Not authenticated`);
  }

  next();
}

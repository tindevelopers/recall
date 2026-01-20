#!/usr/bin/env node

/**
 * Script to delete all calendars for the authenticated user using the v1 API endpoint.
 * This uses the DELETE /api/v1/calendar/user/ endpoint.
 * 
 * Note: V1 calendar API uses X-RecallCalendarAuthToken header.
 */

import dotenv from "dotenv";
dotenv.config();

// Ensure environment variables are set
if (!process.env.RECALL_API_HOST) {
  console.error("Error: RECALL_API_HOST must be set");
  process.exit(1);
}

const url = `${process.env.RECALL_API_HOST}/api/v1/calendar/user/`;

// V1 calendar API uses X-RecallCalendarAuthToken header
// Try API key first, or use V1_CALENDAR_AUTH_TOKEN if set
const v1Token = process.env.V1_CALENDAR_AUTH_TOKEN || process.env.RECALL_API_KEY;

if (!v1Token) {
  console.error("Error: V1_CALENDAR_AUTH_TOKEN or RECALL_API_KEY must be set");
  console.error("Note: V1 calendar API requires X-RecallCalendarAuthToken header");
  process.exit(1);
}

console.log(`Deleting calendars for user at: ${url}`);
console.log(`Using V1 Calendar Auth Token: ${v1Token.substring(0, 10)}...`);

try {
  // V1 calendar API uses X-RecallCalendarAuthToken header (not Authorization)
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "X-RecallCalendarAuthToken": v1Token,
    },
  });

  const text = await response.text();
  
  console.log(`Status: ${response.status}`);
  console.log(`Response: ${text}`);
  
  if (response.ok) {
    console.log("\n✓ Successfully deleted calendars for user");
  } else {
    console.log(`\n✗ Failed to delete calendars (status ${response.status})`);
    if (response.status === 403) {
      console.log("\nNote: V1 calendar API requires X-RecallCalendarAuthToken header.");
      console.log("You may need to authenticate first via /api/v1/calendar/authenticate/");
    }
  }
} catch (error) {
  console.error("Error:", error.message);
  console.error(error.stack);
  process.exit(1);
}

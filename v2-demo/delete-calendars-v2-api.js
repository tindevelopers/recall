#!/usr/bin/env node

/**
 * Script to delete calendars using v2 API.
 * These calendars might be v2 calendars that are showing in the dashboard.
 */

import dotenv from "dotenv";
dotenv.config();

import { getClient } from "./services/recall/api-client.js";

// Ensure environment variables are set
if (!process.env.RECALL_API_KEY || !process.env.RECALL_API_HOST) {
  console.error("Error: RECALL_API_KEY and RECALL_API_HOST must be set");
  process.exit(1);
}

const v1CalendarIds = [
  "1b141c41-680e-4fbd-abb6-7c458037a733",
  "21e36107-8b1a-4f84-9793-3d9260608a82",
  "46680b8b-e217-4704-a083-67d95c86114e",
  "48fb50f1-d772-453f-a058-04a57eedaca2",
  "568d1012-4dc0-4f3d-a241-2cb40984e1c9",
  "61265a99-b1ab-4e89-83c0-d6d3405de968",
  "b3575e85-d2b3-4cd8-9e38-66a87da5b4e8",
  "bb8e5eed-8a62-4bc8-8520-3fbf9a01eeb4",
];

async function deleteCalendarsV2() {
  const client = getClient();
  
  console.log(`Attempting to delete ${v1CalendarIds.length} calendars using v2 API...\n`);
  
  let deletedCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;
  
  for (const calendarId of v1CalendarIds) {
    try {
      console.log(`Deleting calendar ${calendarId}...`);
      
      // Try v2 API
      try {
        await client.request({
          path: `/api/v2/calendars/${calendarId}/`,
          method: "DELETE",
        });
        console.log(`  ✓ Deleted via v2 API`);
        deletedCount++;
        continue;
      } catch (v2Error) {
        if (v2Error.res?.status === 404 || v2Error.message?.includes("404")) {
          console.log(`  ⚠ Not found in v2 API, trying v1 API...`);
        } else {
          console.log(`  ⚠ v2 API error: ${v2Error.message}`);
        }
      }
      
      // Try v1 API with the calendar ID endpoint
      try {
        const v1Token = await authenticateV1Calendar();
        await client.request({
          url: `${process.env.RECALL_API_HOST}/api/v1/calendar/${calendarId}/`,
          method: "DELETE",
          headers: {
            "X-RecallCalendarAuthToken": v1Token,
          },
        });
        console.log(`  ✓ Deleted via v1 API`);
        deletedCount++;
      } catch (v1Error) {
        if (v1Error.res?.status === 404 || v1Error.message?.includes("404")) {
          console.log(`  ⚠ Calendar not found in either API`);
          notFoundCount++;
        } else {
          console.log(`  ✗ Error: ${v1Error.message}`);
          errorCount++;
        }
      }
    } catch (error) {
      console.error(`  ✗ Unexpected error: ${error.message}`);
      errorCount++;
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Deleted: ${deletedCount}`);
  console.log(`  Not Found: ${notFoundCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`${'='.repeat(60)}`);
}

async function authenticateV1Calendar() {
  // Try to get a token for any user - we'll use the first user from the database
  const { connect: connectDb } = await import("./db.js");
  const dbModule = await import("./db.js");
  const db = dbModule.default;
  
  await connectDb();
  const users = await db.User.findAll({ limit: 1 });
  
  if (users.length === 0) {
    throw new Error("No users found for authentication");
  }
  
  const authUrl = `${process.env.RECALL_API_HOST}/api/v1/calendar/authenticate/`;
  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${process.env.RECALL_API_KEY}`,
    },
    body: JSON.stringify({ user_id: users[0].id }),
  });
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Authentication failed: ${JSON.stringify(data)}`);
  }
  
  return data.token || data.auth_token || data.calendar_token || data.access_token || data;
}

// Initialize Recall service
import Recall from "./services/recall/index.js";
Recall.initialize();

deleteCalendarsV2().catch((error) => {
  console.error("Fatal error:", error);
  console.error(error.stack);
  process.exit(1);
});


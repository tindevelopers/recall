#!/usr/bin/env node

/**
 * Script to investigate what calendars/connections actually exist in the API.
 * We'll try various endpoints to see where these calendars are stored.
 */

import dotenv from "dotenv";
dotenv.config();

import { getClient } from "./services/recall/api-client.js";

// Ensure environment variables are set
if (!process.env.RECALL_API_KEY || !process.env.RECALL_API_HOST) {
  console.error("Error: RECALL_API_KEY and RECALL_API_HOST must be set");
  process.exit(1);
}

const client = getClient();
const apiHost = process.env.RECALL_API_HOST;

// Calendar IDs from dashboard
const calendarIds = [
  "1b141c41-680e-4fbd-abb6-7c458037a733",
  "21e36107-8b1a-4f84-9793-3d9260608a82",
  "46680b8b-e217-4704-a083-67d95c86114e",
  "48fb50f1-d772-453f-a058-04a57eedaca2",
  "568d1012-4dc0-4f3d-a241-2cb40984e1c9",
  "61265a99-b1ab-4e89-83c0-d6d3405de968",
  "b3575e85-d2b3-4cd8-9e38-66a87da5b4e8",
  "bb8e5eed-8a62-4bc8-8520-3fbf9a01eeb4",
];

async function tryEndpoint(path, method = "GET", extraHeaders = {}, body = null) {
  try {
    const url = `${apiHost}${path}`;
    console.log(`\nTrying: ${method} ${path}`);
    
    const fetchOptions = {
      method,
      headers: {
        Authorization: `Token ${process.env.RECALL_API_KEY}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
    };
    
    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, fetchOptions);
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    
    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      console.log(`  ✓ Success:`, JSON.stringify(data, null, 2).substring(0, 500));
    } else {
      console.log(`  ✗ Failed:`, text.substring(0, 200));
    }
    
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function tryGetCalendar(id) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Trying to get calendar ${id}`);
  console.log(`${'='.repeat(60)}`);
  
  // Try various endpoints
  await tryEndpoint(`/api/v2/calendars/${id}/`);
  await tryEndpoint(`/api/v1/calendar/${id}/`);
  await tryEndpoint(`/api/v1/calendars/${id}/`);
  await tryEndpoint(`/api/v2/calendar/${id}/`);
}

async function main() {
  console.log("Investigating calendar endpoints...\n");
  
  // Try listing endpoints
  console.log("=".repeat(60));
  console.log("LISTING ENDPOINTS");
  console.log("=".repeat(60));
  
  await tryEndpoint("/api/v2/calendars/");
  await tryEndpoint("/api/v1/calendar/");
  await tryEndpoint("/api/v1/calendars/");
  await tryEndpoint("/api/v2/calendar/");
  await tryEndpoint("/api/v1/calendar/connections/");
  await tryEndpoint("/api/v1/calendar/users/");
  
  // Try to get specific calendars
  console.log("\n\n" + "=".repeat(60));
  console.log("GETTING SPECIFIC CALENDARS");
  console.log("=".repeat(60));
  
  for (const id of calendarIds.slice(0, 2)) { // Try first 2 to avoid too much output
    await tryGetCalendar(id);
  }
  
  // Try deleting with different methods
  console.log("\n\n" + "=".repeat(60));
  console.log("TRYING DELETE METHODS");
  console.log("=".repeat(60));
  
  // First authenticate to get v1 token
  const { connect: connectDb } = await import("./db.js");
  const dbModule = await import("./db.js");
  const db = dbModule.default;
  
  await connectDb();
  const users = await db.User.findAll({ limit: 1 });
  
  if (users.length > 0) {
    const authResult = await tryEndpoint("/api/v1/calendar/authenticate/", "POST", {}, {
      user_id: users[0].id,
    });
    
    if (authResult.ok && authResult.data?.token) {
      const token = authResult.data.token;
      console.log(`\nGot V1 token, trying delete with it...`);
      
      // Try deleting each calendar with v1 token
      for (const id of calendarIds.slice(0, 2)) {
        await tryEndpoint(`/api/v1/calendar/${id}/`, "DELETE", {
          "X-RecallCalendarAuthToken": token,
        });
      }
    }
  }
  
  // Try v2 delete
  for (const id of calendarIds.slice(0, 2)) {
    await tryEndpoint(`/api/v2/calendars/${id}/`, "DELETE");
  }
  
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  console.error(error.stack);
  process.exit(1);
});


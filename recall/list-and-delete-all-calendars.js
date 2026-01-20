#!/usr/bin/env node

/**
 * Script to list all calendars and delete them.
 * This will help us see what calendars actually exist and delete them properly.
 */

import dotenv from "dotenv";
dotenv.config();

import { connect as connectDb } from "./db.js";
import db from "./db.js";
import { getClient } from "./services/recall/api-client.js";
import Recall from "./services/recall/index.js";

// Ensure environment variables are set
if (!process.env.RECALL_API_KEY || !process.env.RECALL_API_HOST) {
  console.error("Error: RECALL_API_KEY and RECALL_API_HOST must be set");
  process.exit(1);
}

async function listAllCalendars() {
  const client = getClient();
  const calendars = [];
  
  // Try to list from v2 API
  try {
    console.log("Listing calendars from v2 API...");
    let pageUrl = null;
    
    while (true) {
      const response = pageUrl 
        ? await client.request({ url: pageUrl, method: "GET" })
        : await client.request({ path: "/api/v2/calendars/", method: "GET" });
      
      const results = response.results || (Array.isArray(response) ? response : []);
      calendars.push(...results);
      console.log(`  Found ${results.length} calendars in this page (total: ${calendars.length})`);
      
      const next = response.next;
      if (!next) {
        break;
      }
      
      if (next.indexOf("https:") === -1 && pageUrl && pageUrl.indexOf("https:") !== -1) {
        pageUrl = next.replace("http:", "https:");
      } else {
        pageUrl = next;
      }
    }
  } catch (error) {
    console.log(`  Could not list from v2 API: ${error.message}`);
  }
  
  return calendars;
}

async function authenticateAndDeleteV1(userId) {
  const authUrl = `${process.env.RECALL_API_HOST}/api/v1/calendar/authenticate/`;
  
  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${process.env.RECALL_API_KEY}`,
    },
    body: JSON.stringify({ user_id: userId }),
  });
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Authentication failed: ${JSON.stringify(data)}`);
  }
  
  const token = data.token || data.auth_token || data.calendar_token || data.access_token || data;
  
  // Delete all calendars for this user
  const deleteUrl = `${process.env.RECALL_API_HOST}/api/v1/calendar/user/`;
  const deleteResponse = await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      "X-RecallCalendarAuthToken": typeof token === 'string' ? token : JSON.stringify(token),
    },
  });
  
  return deleteResponse.ok || deleteResponse.status === 204;
}

async function main() {
  try {
    // Initialize services
    Recall.initialize();
    await connectDb();
    console.log("✓ Services initialized\n");
    
    // List all calendars from v2 API
    const v2Calendars = await listAllCalendars();
    console.log(`\nFound ${v2Calendars.length} total calendars in v2 API\n`);
    
    if (v2Calendars.length > 0) {
      console.log("Calendars found:");
      v2Calendars.forEach((cal, index) => {
        const id = cal.id || cal.calendar_id;
        const email = cal.platform_email || cal.email || "None";
        const status = cal.status || "unknown";
        console.log(`  ${index + 1}. ID: ${id}`);
        console.log(`     Email: ${email}`);
        console.log(`     Status: ${status}`);
      });
      
      // Delete each calendar individually
      console.log(`\n${'='.repeat(60)}`);
      console.log("Deleting calendars individually...");
      console.log(`${'='.repeat(60)}\n`);
      
      let deletedCount = 0;
      for (const cal of v2Calendars) {
        const id = cal.id || cal.calendar_id;
        try {
          await Recall.deleteCalendar(id);
          console.log(`  ✓ Deleted calendar ${id}`);
          deletedCount++;
        } catch (error) {
          console.log(`  ✗ Failed to delete ${id}: ${error.message}`);
        }
      }
      
      console.log(`\nDeleted ${deletedCount} of ${v2Calendars.length} calendars`);
    }
    
    // Also delete via v1 API for all users
    console.log(`\n${'='.repeat(60)}`);
    console.log("Deleting calendars via v1 API for all users...");
    console.log(`${'='.repeat(60)}\n`);
    
    const users = await db.User.findAll({ limit: 10 });
    for (const user of users) {
      try {
        const success = await authenticateAndDeleteV1(user.id);
        if (success) {
          console.log(`  ✓ Deleted calendars for user ${user.id}`);
        } else {
          console.log(`  ⚠ Failed to delete calendars for user ${user.id}`);
        }
      } catch (error) {
        console.log(`  ✗ Error for user ${user.id}: ${error.message}`);
      }
    }
    
    console.log("\n✓ Cleanup complete!");
    process.exit(0);
  } catch (error) {
    console.error("\nFatal error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();


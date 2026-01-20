#!/usr/bin/env node

/**
 * Script to delete all V1 calendar connections from Recall API.
 * 
 * This script:
 * 1. Lists all calendars from Recall API (both v1 and v2)
 * 2. Identifies V1 calendars (those without email/connections or using v1 API)
 * 3. Deletes them from Recall API
 */

import dotenv from "dotenv";
dotenv.config();

// Ensure environment variables are set
if (!process.env.RECALL_API_KEY || !process.env.RECALL_API_HOST) {
  console.error("Error: RECALL_API_KEY and RECALL_API_HOST must be set");
  console.error("RECALL_API_KEY:", process.env.RECALL_API_KEY ? "✓ Set" : "✗ Missing");
  console.error("RECALL_API_HOST:", process.env.RECALL_API_HOST || "✗ Missing");
  process.exit(1);
}

import { getClient } from "./services/recall/api-client.js";

async function listV1Calendars() {
  const client = getClient();
  const calendars = [];
  
  // Try to list calendars from v1 API
  try {
    const response = await client.request({
      path: "/api/v1/calendar/",
      method: "GET",
    });
      
    // Handle different response formats
    const results = response.results || response.calendars || (Array.isArray(response) ? response : []);
    calendars.push(...results);
    
    // Handle pagination
    let next = response.next;
    while (next) {
      const nextResponse = await client.request({
        url: next,
        method: "GET",
      });
      
      const nextResults = nextResponse.results || nextResponse.calendars || (Array.isArray(nextResponse) ? nextResponse : []);
      calendars.push(...nextResults);
      next = nextResponse.next;
    }
  } catch (error) {
    console.log(`Note: Could not list from v1 API: ${error.message}`);
  }
  
  return calendars;
}

async function listV2Calendars() {
  const client = getClient();
  const calendars = [];
  
  // List calendars from v2 API
  try {
    let pageUrl = null;
    
    while (true) {
      const response = pageUrl 
        ? await client.request({ url: pageUrl, method: "GET" })
        : await client.request({ path: "/api/v2/calendars/", method: "GET" });
      
      const results = response.results || (Array.isArray(response) ? response : []);
      calendars.push(...results);
      
      const next = response.next;
      if (!next) {
        break;
      }
      
      // Fix URL protocol if needed
      if (next.indexOf("https:") === -1 && pageUrl && pageUrl.indexOf("https:") !== -1) {
        pageUrl = next.replace("http:", "https:");
      } else {
        pageUrl = next;
      }
    }
  } catch (error) {
    console.log(`Note: Could not list from v2 API: ${error.message}`);
    console.log(`Error details:`, error);
  }
  
  return calendars;
}

async function deleteCalendar(calendarId) {
  const client = getClient();
  
  // Try v2 API first
  try {
    await client.request({
      path: `/api/v2/calendars/${calendarId}/`,
      method: "DELETE",
    });
    return true;
  } catch (error) {
    // If v2 fails, try v1 API
    try {
      await client.request({
        path: `/api/v1/calendar/${calendarId}/`,
        method: "DELETE",
      });
      return true;
    } catch (error2) {
      throw new Error(`Failed to delete from both APIs: ${error.message}, ${error2.message}`);
    }
  }
}

async function deleteV1Calendars() {
  try {
    console.log("Fetching calendars from Recall API...\n");
    
    // List calendars from both APIs
    const [v1Calendars, v2Calendars] = await Promise.all([
      listV1Calendars(),
      listV2Calendars(),
    ]);
    
    console.log(`Found ${v1Calendars.length} calendars from v1 API`);
    console.log(`Found ${v2Calendars.length} calendars from v2 API\n`);
    
    // Identify V1 calendars - those without email or connections
    const allCalendars = [...v1Calendars, ...v2Calendars];
    
    // Deduplicate by ID
    const uniqueCalendars = new Map();
    for (const cal of allCalendars) {
      const id = cal.id || cal.calendar_id;
      if (id && !uniqueCalendars.has(id)) {
        uniqueCalendars.set(id, cal);
      }
    }
    
    // Also try to fetch calendars individually if we have specific IDs from the dashboard
    // These are the V1 calendar IDs shown in the dashboard image
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
    
    console.log(`\nFetching specific V1 calendar IDs from dashboard...`);
    const client = getClient();
    for (const id of v1CalendarIds) {
      try {
        // Try v2 API first
        const cal = await client.request({
          path: `/api/v2/calendars/${id}/`,
          method: "GET",
        });
        if (cal && !uniqueCalendars.has(id)) {
          uniqueCalendars.set(id, cal);
          console.log(`  Found calendar ${id}`);
        }
      } catch (error) {
        // Try v1 API
        try {
          const cal = await client.request({
            path: `/api/v1/calendar/${id}/`,
            method: "GET",
          });
          if (cal && !uniqueCalendars.has(id)) {
            uniqueCalendars.set(id, cal);
            console.log(`  Found calendar ${id} via v1 API`);
          }
        } catch (error2) {
          console.log(`  Calendar ${id} not found (may already be deleted)`);
        }
      }
    }
    
    const calendarsToDelete = Array.from(uniqueCalendars.values()).filter((cal) => {
      const email = cal.platform_email || cal.email;
      const status = cal.status;
      const connections = cal.connections;
      
      // V1 calendars typically don't have email or have "None" connections
      const hasNoEmail = !email || email === "None" || email === null || email === undefined;
      const hasNoConnections = !connections || connections === "None" || connections === null || connections === undefined || (Array.isArray(connections) && connections.length === 0);
      const isDisconnected = status === "disconnected" || status === "connecting";
      
      // Also include calendars from the specific V1 ID list
      const id = cal.id || cal.calendar_id;
      const isV1Calendar = v1CalendarIds.includes(id);
      
      return isV1Calendar || hasNoEmail || hasNoConnections || isDisconnected;
    });
    
    let deletedCount = 0;
    let errorCount = 0;
    
    // Also try to delete the specific V1 calendar IDs directly, even if we couldn't fetch them
    console.log(`\nAttempting to delete specific V1 calendar IDs directly...`);
    for (const id of v1CalendarIds) {
      if (!calendarsToDelete.find(cal => (cal.id || cal.calendar_id) === id)) {
        // Try to delete it anyway - it might exist but not be fetchable
        try {
          await deleteCalendar(id);
          console.log(`  ✓ Deleted calendar ${id} directly`);
          deletedCount++;
        } catch (error) {
          // Calendar might not exist - that's okay
          if (error.res?.status === 404 || error.message?.includes("404")) {
            console.log(`  ⚠ Calendar ${id} not found (may already be deleted)`);
          } else {
            console.log(`  ⚠ Error deleting ${id}: ${error.message}`);
            errorCount++;
          }
        }
      }
    }
    
    console.log(`\nFound ${calendarsToDelete.length} V1/unconnected calendars to delete:\n`);
    
    if (calendarsToDelete.length === 0 && deletedCount === 0) {
      console.log("No V1 calendars found. Nothing to delete.");
      process.exit(0);
    }
    
    // Display calendars to be deleted
    calendarsToDelete.forEach((cal, index) => {
      const id = cal.id || cal.calendar_id;
      const email = cal.platform_email || cal.email || "None";
      const status = cal.status || "unknown";
      const externalId = cal.external_id || cal.externalId || "N/A";
      
      console.log(`${index + 1}. Calendar ID: ${id}`);
      console.log(`   External ID: ${externalId}`);
      console.log(`   Email: ${email}`);
      console.log(`   Status: ${status}`);
    });
    
    console.log(`\n⚠️  About to delete ${calendarsToDelete.length} calendars from Recall API...`);
    console.log("Starting deletion process...\n");
    
    // Delete each calendar
    for (const cal of calendarsToDelete) {
      const id = cal.id || cal.calendar_id;
      try {
        console.log(`Deleting calendar ${id}...`);
        await deleteCalendar(id);
        console.log(`  ✓ Deleted successfully`);
        deletedCount++;
      } catch (error) {
        console.error(`  ✗ Error deleting calendar ${id}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`\n✓ Cleanup complete!`);
    console.log(`  Deleted: ${deletedCount}`);
    console.log(`  Errors: ${errorCount}`);
    
    process.exit(0);
  } catch (error) {
    console.error("Fatal error:", error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the cleanup
deleteV1Calendars();


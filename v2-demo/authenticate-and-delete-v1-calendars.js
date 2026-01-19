#!/usr/bin/env node

/**
 * Script to authenticate with v1 calendar API and delete all calendars.
 * 
 * Steps:
 * 1. Get user_id from database (or use provided one)
 * 2. Authenticate with /api/v1/calendar/authenticate/ to get V1 calendar token
 * 3. Use token to delete calendars via DELETE /api/v1/calendar/user/
 */

import dotenv from "dotenv";
dotenv.config();

import { connect as connectDb } from "./db.js";
import db from "./db.js";

// Ensure environment variables are set
if (!process.env.RECALL_API_KEY || !process.env.RECALL_API_HOST) {
  console.error("Error: RECALL_API_KEY and RECALL_API_HOST must be set");
  process.exit(1);
}

async function authenticateV1Calendar(userId) {
  const authUrl = `${process.env.RECALL_API_HOST}/api/v1/calendar/authenticate/`;
  
  console.log(`Authenticating with v1 calendar API for user: ${userId}`);
  console.log(`URL: ${authUrl}`);
  
  try {
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
    
    console.log(`✓ Authentication successful`);
    console.log(`Response:`, JSON.stringify(data, null, 2));
    
    // The token is usually in the response - check common fields
    const token = data.token || data.auth_token || data.calendar_token || data.access_token || data;
    
    return token;
  } catch (error) {
    console.error(`✗ Authentication failed:`, error.message);
    throw error;
  }
}

async function deleteV1Calendars(token) {
  const url = `${process.env.RECALL_API_HOST}/api/v1/calendar/user/`;
  
  console.log(`\nDeleting calendars using V1 calendar token...`);
  console.log(`URL: ${url}`);
  
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-RecallCalendarAuthToken": typeof token === 'string' ? token : JSON.stringify(token),
      },
    });
    
    const text = await response.text();
    
    console.log(`Status: ${response.status}`);
    console.log(`Response: ${text}`);
    
    if (response.ok) {
      console.log("\n✓ Successfully deleted all V1 calendars for user");
      return true;
    } else {
      console.log(`\n✗ Failed to delete calendars (status ${response.status})`);
      return false;
    }
  } catch (error) {
    console.error("Error deleting calendars:", error.message);
    throw error;
  }
}

async function main() {
  try {
    // Connect to database to get user_id
    await connectDb();
    console.log("✓ Database connected\n");
    
    // Get users from database
    const users = await db.User.findAll({
      limit: 10,
      order: [["createdAt", "DESC"]],
    });
    
    if (users.length === 0) {
      console.error("No users found in database. Cannot proceed.");
      process.exit(1);
    }
    
    console.log(`Found ${users.length} user(s) in database:`);
    users.forEach((user, index) => {
      console.log(`  ${index + 1}. User ID: ${user.id}`);
    });
    
    // Also try to delete specific calendar IDs directly
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
    
    // Try deleting for all users
    for (const user of users) {
      const userId = user.id;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Processing User ID: ${userId}`);
      console.log(`${'='.repeat(60)}\n`);
      
      try {
        // Step 1: Authenticate to get V1 calendar token
        const token = await authenticateV1Calendar(userId);
        
        // Step 2: Delete calendars using the token
        await deleteV1Calendars(token);
        
        // Step 3: Also try deleting specific calendar IDs individually
        console.log(`\nAttempting to delete specific calendar IDs individually...`);
        let deletedCount = 0;
        let notFoundCount = 0;
        
        for (const calendarId of v1CalendarIds) {
          try {
            const deleteUrl = `${process.env.RECALL_API_HOST}/api/v1/calendar/${calendarId}/`;
            const deleteResponse = await fetch(deleteUrl, {
              method: "DELETE",
              headers: {
                "X-RecallCalendarAuthToken": typeof token === 'string' ? token : JSON.stringify(token),
              },
            });
            
            if (deleteResponse.ok || deleteResponse.status === 204) {
              console.log(`  ✓ Deleted calendar ${calendarId}`);
              deletedCount++;
            } else if (deleteResponse.status === 404) {
              console.log(`  ⚠ Calendar ${calendarId} not found`);
              notFoundCount++;
            } else {
              const text = await deleteResponse.text();
              console.log(`  ✗ Failed to delete ${calendarId}: ${deleteResponse.status} - ${text}`);
            }
          } catch (error) {
            console.log(`  ✗ Error deleting ${calendarId}: ${error.message}`);
          }
        }
        
        console.log(`\nIndividual deletion summary: ${deletedCount} deleted, ${notFoundCount} not found`);
      } catch (error) {
        console.error(`Failed for user ${userId}:`, error.message);
        // Continue with next user
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error("\nFatal error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();


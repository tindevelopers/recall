#!/usr/bin/env node

/**
 * Script to delete v1 calendar users.
 * These are user records in the v1 calendar system, accessed via /api/v1/calendar/users/
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

const apiHost = process.env.RECALL_API_HOST;

async function authenticateV1Calendar(userId) {
  const authUrl = `${apiHost}/api/v1/calendar/authenticate/`;
  
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
  
  return data.token || data.auth_token || data.calendar_token || data.access_token || data;
}

async function listV1CalendarUsers() {
  const url = `${apiHost}/api/v1/calendar/users/`;
  
  console.log(`Listing v1 calendar users from: ${url}`);
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Token ${process.env.RECALL_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to list users: ${response.status} - ${await response.text()}`);
  }
  
  const users = await response.json();
  return Array.isArray(users) ? users : [];
}

async function deleteV1CalendarUser(userId, v1Token) {
  // Try multiple endpoints
  const endpoints = [
    `/api/v1/calendar/users/${userId}/`,
    `/api/v1/calendar/user/${userId}/`,
    `/api/v1/calendar/${userId}/`,
  ];
  
  console.log(`  Deleting user ${userId}...`);
  
  for (const endpoint of endpoints) {
    const url = `${apiHost}${endpoint}`;
    
    // Try with v1 token
    let response = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-RecallCalendarAuthToken": typeof v1Token === 'string' ? v1Token : JSON.stringify(v1Token),
        "Content-Type": "application/json",
      },
    });
    
    if (response.ok || response.status === 204) {
      console.log(`    ✓ Deleted successfully via ${endpoint}`);
      return true;
    }
    
    // Try with API key
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Token ${process.env.RECALL_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    
    if (response.ok || response.status === 204) {
      console.log(`    ✓ Deleted successfully via ${endpoint} (with API key)`);
      return true;
    }
  }
  
  console.log(`    ✗ Failed: All endpoints returned errors`);
  return false;
}

async function main() {
  try {
    await connectDb();
    console.log("✓ Database connected\n");
    
    // List all v1 calendar users
    const users = await listV1CalendarUsers();
    console.log(`Found ${users.length} v1 calendar users:\n`);
    
    if (users.length === 0) {
      console.log("No v1 calendar users found.");
      process.exit(0);
    }
    
    // Display users
    users.forEach((user, index) => {
      const id = user.id;
      const externalId = user.external_id || "N/A";
      const connections = user.connections || [];
      const connectedCount = connections.filter(c => c.connected).length;
      
      console.log(`${index + 1}. User ID: ${id}`);
      console.log(`   External ID: ${externalId}`);
      console.log(`   Connections: ${connectedCount}/${connections.length} connected`);
    });
    
    // Get v1 token for deletion
    const dbUsers = await db.User.findAll({ limit: 1 });
    if (dbUsers.length === 0) {
      throw new Error("No users in database for authentication");
    }
    
    console.log(`\nAuthenticating to get v1 calendar token...`);
    const v1Token = await authenticateV1Calendar(dbUsers[0].id);
    console.log(`✓ Got v1 calendar token\n`);
    
    // Try to delete by authenticating as each user (using their external_id as user_id)
    console.log(`${'='.repeat(60)}`);
    console.log("Deleting v1 calendar users by authenticating as each...");
    console.log(`${'='.repeat(60)}\n`);
    
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const user of users) {
      const externalId = user.external_id;
      if (!externalId) {
        console.log(`  Skipping user ${user.id} (no external_id)`);
        continue;
      }
      
      // For email addresses, try using just the part before @ or the full email
      let userIdToAuth = externalId;
      if (externalId.includes('@')) {
        // Try the email as-is first
        userIdToAuth = externalId;
      }
      
      try {
        console.log(`  Authenticating as user with external_id: ${externalId}...`);
        const userToken = await authenticateV1Calendar(externalId);
        
        // Now delete calendars for this user
        const deleteUrl = `${apiHost}/api/v1/calendar/user/`;
        const deleteResponse = await fetch(deleteUrl, {
          method: "DELETE",
          headers: {
            "X-RecallCalendarAuthToken": typeof userToken === 'string' ? userToken : JSON.stringify(userToken),
          },
        });
        
        if (deleteResponse.ok || deleteResponse.status === 204) {
          console.log(`    ✓ Deleted calendars for user ${user.id}`);
          deletedCount++;
        } else {
          const text = await deleteResponse.text();
          console.log(`    ✗ Failed: ${deleteResponse.status} - ${text.substring(0, 100)}`);
          errorCount++;
        }
      } catch (error) {
        console.log(`    ✗ Error: ${error.message}`);
        errorCount++;
      }
    }
    
    // Also try the original method
    console.log(`\nTrying direct deletion...`);
    for (const user of users) {
      const success = await deleteV1CalendarUser(user.id, v1Token);
      if (success) {
        deletedCount++;
      } else {
        errorCount++;
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Summary:`);
    console.log(`  Deleted: ${deletedCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`${'='.repeat(60)}`);
    
    process.exit(0);
  } catch (error) {
    console.error("\nFatal error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();


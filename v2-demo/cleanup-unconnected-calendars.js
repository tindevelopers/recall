#!/usr/bin/env node

/**
 * Cleanup script to delete calendars that are not properly connected.
 * 
 * This script identifies calendars that:
 * - Don't have an email (platform_email and email are both null/undefined)
 * - Are not connected (status is "connecting" or not "connected")
 * 
 * It then deletes these calendars from both Recall API and the local database.
 */

import dotenv from "dotenv";
dotenv.config();

import { connect as connectDb } from "./db.js";
import db from "./db.js";
import Recall from "./services/recall/index.js";

async function cleanupUnconnectedCalendars() {
  try {
    // Initialize database connection
    await connectDb();
    console.log("✓ Database connected");

    // Initialize Recall service
    Recall.initialize();
    console.log("✓ Recall service initialized");

    // Find all calendars
    const allCalendars = await db.Calendar.findAll({
      order: [["createdAt", "DESC"]],
    });

    console.log(`\nFound ${allCalendars.length} total calendars`);

    // Identify unconnected calendars
    const unconnectedCalendars = allCalendars.filter((calendar) => {
      const recallData = calendar.recallData || {};
      
      // Check email from recallData (raw database field)
      const platformEmail = recallData.platform_email || recallData.email;
      const hasNoEmail = !platformEmail || platformEmail === null || platformEmail === undefined;
      
      // Check status from recallData
      const status = recallData.status;
      const isNotConnected = status && status !== "connected" && status !== "active";
      
      // Also check if status is missing and email is missing (likely never connected)
      const neverConnected = !status && hasNoEmail;

      return hasNoEmail || isNotConnected || neverConnected;
    });

    console.log(`\nFound ${unconnectedCalendars.length} unconnected calendars to delete:`);
    
    if (unconnectedCalendars.length === 0) {
      console.log("No unconnected calendars found. Nothing to clean up.");
      process.exit(0);
    }

    // Display calendars to be deleted
    unconnectedCalendars.forEach((calendar, index) => {
      const recallData = calendar.recallData || {};
      const platformEmail = recallData.platform_email || recallData.email || "None";
      const status = recallData.status || "unknown";
      
      console.log(`\n${index + 1}. Calendar ID: ${calendar.id}`);
      console.log(`   Recall ID: ${calendar.recallId}`);
      console.log(`   Platform: ${calendar.platform}`);
      console.log(`   Email: ${platformEmail}`);
      console.log(`   Status: ${status}`);
      console.log(`   Created: ${calendar.createdAt}`);
    });

    // Ask for confirmation (in a real script, you might want to add a prompt)
    console.log(`\n⚠️  About to delete ${unconnectedCalendars.length} calendars...`);
    console.log("Starting deletion process...\n");

    let deletedCount = 0;
    let errorCount = 0;

    // Delete each unconnected calendar
    for (const calendar of unconnectedCalendars) {
      try {
        console.log(`Deleting calendar ${calendar.id} (Recall ID: ${calendar.recallId})...`);

        // Try to delete from Recall API first
        try {
          await Recall.deleteCalendar(calendar.recallId);
          console.log(`  ✓ Deleted from Recall API`);
        } catch (recallError) {
          // If calendar doesn't exist in Recall, that's okay - continue with local deletion
          if (recallError.response?.status === 404 || recallError.message?.includes("404")) {
            console.log(`  ⚠ Calendar not found in Recall API (may have been deleted already)`);
          } else {
            console.log(`  ⚠ Failed to delete from Recall API: ${recallError.message}`);
            // Continue anyway - we'll still delete from local DB
          }
        }

        // Delete from local database
        await calendar.destroy();
        console.log(`  ✓ Deleted from local database`);
        deletedCount++;

      } catch (error) {
        console.error(`  ✗ Error deleting calendar ${calendar.id}:`, error.message);
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
cleanupUnconnectedCalendars();


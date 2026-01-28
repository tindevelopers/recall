import { checkCalendarConnections, getDisconnectionNotifications } from "../../utils/check-calendar-connections.js";
import db from "../../db.js";
import { generateNotice } from "../../routes/utils.js";

/**
 * Periodic job to check calendar connection status
 * Runs every 15 minutes to verify calendars are still connected
 * Notifies users if connections break
 */
export default async (job) => {
  console.log(`[CONNECTION-CHECK] Starting periodic calendar connection check...`);
  
  try {
    const result = await checkCalendarConnections();
    
    console.log(
      `[CONNECTION-CHECK] Check complete: ${result.checkedCount} calendar(s) checked, ${result.statusChanges.length} status change(s)`
    );

    // If there are status changes (disconnections), notify users
    if (result.statusChanges.length > 0) {
      const notifications = getDisconnectionNotifications(result.statusChanges);
      
      console.log(
        `[CONNECTION-CHECK] ⚠️  Found ${notifications.length} disconnected calendar(s) - users will be notified on next page load`
      );

      // Store notifications in database for users to see
      // We'll check these notifications when users visit pages
      // For now, we'll log them - the frontend will check status on page load
      for (const notification of notifications) {
        console.log(
          `[CONNECTION-CHECK] User ${notification.userId} - Calendar ${notification.calendarId} disconnected: ${notification.message}`
        );
        
        // TODO: Could store in a notifications table or user preferences
        // For now, the status will be updated in the database and frontend will show it
      }
    }

    return {
      success: true,
      checkedCount: result.checkedCount,
      statusChanges: result.statusChanges.length,
      errors: result.errors.length,
    };
  } catch (error) {
    console.error(`[CONNECTION-CHECK] Error in connection check job:`, error);
    throw error;
  }
};

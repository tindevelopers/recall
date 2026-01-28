import Recall from "../services/recall/index.js";
import db from "../db.js";

/**
 * Check calendar connection status by querying Recall API
 * Compares actual status with stored status and updates database
 * Returns information about status changes for notifications
 */
export async function checkCalendarConnections() {
  console.log(`[CONNECTION-CHECK] Starting calendar connection status check...`);
  
  try {
    // Get all calendars that have a recallId (connected at some point)
    const calendars = await db.Calendar.findAll({
      where: {
        recallId: { [db.Sequelize.Op.ne]: null },
      },
      include: [{ model: db.User }],
    });

    console.log(`[CONNECTION-CHECK] Found ${calendars.length} calendar(s) to check`);

    const statusChanges = [];
    const errors = [];

    for (const calendar of calendars) {
      try {
        const previousStatus = calendar.status || calendar.recallData?.status || "unknown";
        const calendarEmail = calendar.email || calendar.recallData?.platform_email || "Unknown";
        
        console.log(
          `[CONNECTION-CHECK] Checking calendar ${calendar.id} (${calendarEmail}) - Previous status: ${previousStatus}`
        );

        // Fetch current status from Recall API
        const recallCalendar = await Recall.getCalendar(calendar.recallId);
        
        if (!recallCalendar) {
          console.warn(
            `[CONNECTION-CHECK] Calendar ${calendar.id} not found in Recall API - marking as disconnected`
          );
          
          // Update database to reflect disconnected status
          const updatedRecallData = {
            ...calendar.recallData,
            status: "disconnected",
          };
          await calendar.update({ recallData: updatedRecallData });
          
          if (previousStatus === "connected") {
            statusChanges.push({
              calendar,
              previousStatus,
              newStatus: "disconnected",
              reason: "Calendar not found in Recall API",
            });
          }
          continue;
        }

        const currentStatus = recallCalendar.status || "unknown";
        
        console.log(
          `[CONNECTION-CHECK] Calendar ${calendar.id} - Current status from Recall: ${currentStatus}`
        );

        // Update database with latest data from Recall API
        await calendar.update({ recallData: recallCalendar });

        // Check if status changed from connected to disconnected
        if (
          previousStatus === "connected" &&
          (currentStatus === "disconnected" || currentStatus === "error")
        ) {
          statusChanges.push({
            calendar,
            previousStatus,
            newStatus: currentStatus,
            reason: "Connection status changed in Recall API",
          });
          
          console.warn(
            `[CONNECTION-CHECK] ⚠️  Status change detected for calendar ${calendar.id} (${calendarEmail}): ${previousStatus} → ${currentStatus}`
          );
        } else if (
          previousStatus === "disconnected" &&
          currentStatus === "connected"
        ) {
          console.log(
            `[CONNECTION-CHECK] ✅ Calendar ${calendar.id} (${calendarEmail}) reconnected: ${previousStatus} → ${currentStatus}`
          );
        }
      } catch (error) {
        const errorInfo = {
          calendarId: calendar.id,
          calendarEmail: calendar.email || "Unknown",
          error: error.message,
        };
        errors.push(errorInfo);
        
        console.error(
          `[CONNECTION-CHECK] Error checking calendar ${calendar.id}:`,
          error.message
        );
        
        // If it's an authentication/authorization error, likely disconnected
        if (
          error.message.includes("401") ||
          error.message.includes("403") ||
          error.message.includes("unauthorized") ||
          error.message.includes("forbidden")
        ) {
          const previousStatus = calendar.status || calendar.recallData?.status || "unknown";
          
          if (previousStatus === "connected") {
            const updatedRecallData = {
              ...calendar.recallData,
              status: "disconnected",
            };
            await calendar.update({ recallData: updatedRecallData });
            
            statusChanges.push({
              calendar,
              previousStatus,
              newStatus: "disconnected",
              reason: `API error: ${error.message}`,
            });
          }
        }
      }
    }

    console.log(
      `[CONNECTION-CHECK] ✅ Connection check complete: ${statusChanges.length} status change(s), ${errors.length} error(s)`
    );

    return {
      statusChanges,
      errors,
      checkedCount: calendars.length,
    };
  } catch (error) {
    console.error(`[CONNECTION-CHECK] Fatal error in connection check:`, error);
    throw error;
  }
}

/**
 * Get user notification messages for disconnected calendars
 */
export function getDisconnectionNotifications(statusChanges) {
  const notifications = [];
  
  for (const change of statusChanges) {
    if (change.newStatus === "disconnected") {
      const calendarEmail = change.calendar.email || change.calendar.recallData?.platform_email || "your calendar";
      const platform = change.calendar.platform === "google_calendar" ? "Google Calendar" : "Microsoft Outlook";
      
      notifications.push({
        userId: change.calendar.userId,
        calendarId: change.calendar.id,
        message: `Your ${platform} connection (${calendarEmail}) has been disconnected. Please reconnect your calendar to continue receiving meeting recordings.`,
        type: "error",
      });
    }
  }
  
  return notifications;
}

import Recall from "../../services/recall/index.js";
import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";

/**
 * Periodic sync job to catch events that weren't picked up by webhooks.
 * 
 * Recall.ai webhooks can be delayed or dropped, so this runs periodically
 * to ensure we don't miss any calendar events.
 * 
 * This job:
 * 1. Finds all connected calendars
 * 2. Syncs events from the last 24 hours
 * 3. Updates auto-record status
 * 4. Schedules bots for new events
 */
export default async (job) => {
  console.log(`[PERIODIC-SYNC] Starting periodic calendar sync...`);
  
  try {
    // Get all connected calendars
    const calendars = await db.Calendar.findAll({
      where: {
        recallId: { [db.Sequelize.Op.ne]: null },
      },
    });

    console.log(`[PERIODIC-SYNC] Found ${calendars.length} connected calendar(s)`);

    if (calendars.length === 0) {
      console.log(`[PERIODIC-SYNC] No connected calendars found, skipping sync`);
      return;
    }

    // Sync events for each calendar (last 24 hours)
    const lastUpdatedTimestamp = new Date();
    lastUpdatedTimestamp.setHours(lastUpdatedTimestamp.getHours() - 24);

    let totalEventsSynced = 0;

    for (const calendar of calendars) {
      try {
        console.log(
          `[PERIODIC-SYNC] Syncing calendar ${calendar.id} (${calendar.email || calendar.platform}) since ${lastUpdatedTimestamp.toISOString()}`
        );

        const events = await Recall.fetchCalendarEvents({
          id: calendar.recallId,
          lastUpdatedTimestamp: lastUpdatedTimestamp.toISOString(),
        });

        console.log(
          `[PERIODIC-SYNC] Found ${events.length} event(s) for calendar ${calendar.id}`
        );

        let eventsUpserted = [];
        let eventsDeleted = [];

        for (const event of events) {
          if (event["is_deleted"]) {
            await db.CalendarEvent.destroy({
              where: {
                recallId: event.id,
                calendarId: calendar.id,
              },
            });
            eventsDeleted.push(event);
          } else {
            const [instance, created] = await db.CalendarEvent.upsert({
              recallId: event.id,
              recallData: event,
              platform: event.platform,
              updatedAt: new Date(),
              calendarId: calendar.id,
            });
            eventsUpserted.push(event);
            
            if (created) {
              console.log(
                `[PERIODIC-SYNC] ✅ Created new event: ${event.title || "Untitled"} (${event.id})`
              );
            }
          }
        }

        totalEventsSynced += eventsUpserted.length;

        console.log(
          `[PERIODIC-SYNC] Synced calendar ${calendar.id}: ${eventsUpserted.length} upserted, ${eventsDeleted.length} deleted`
        );

        // Update auto-record status for synced events
        if (eventsUpserted.length > 0) {
          const { updateAutoRecordStatusForCalendarEvents } = await import(
            "../../logic/autorecord.js"
          );

          const dbEvents = await db.CalendarEvent.findAll({
            where: {
              recallId: { [db.Sequelize.Op.in]: eventsUpserted.map((e) => e.id) },
              calendarId: calendar.id,
            },
          });

          await updateAutoRecordStatusForCalendarEvents({
            calendar,
            events: dbEvents,
          });

          // Queue bot scheduling jobs for new/updated events
          for (const event of dbEvents) {
            await backgroundQueue.add("calendarevent.update_bot_schedule", {
              calendarId: calendar.id,
              recallEventId: event.recallId,
            });
          }

          console.log(
            `[PERIODIC-SYNC] Queued ${dbEvents.length} bot scheduling job(s) for calendar ${calendar.id}`
          );
        }

        // Delete bots for deleted events
        for (const event of eventsDeleted) {
          await backgroundQueue.add("calendarevent.delete_bot", {
            recallEventId: event.id,
          });
        }
      } catch (error) {
        console.error(
          `[PERIODIC-SYNC] Error syncing calendar ${calendar.id}:`,
          error.message
        );
        // Continue with other calendars even if one fails
      }
    }

    console.log(
      `[PERIODIC-SYNC] ✅ Periodic sync complete: ${totalEventsSynced} total event(s) synced across ${calendars.length} calendar(s)`
    );
  } catch (error) {
    console.error(`[PERIODIC-SYNC] Error in periodic sync:`, error);
    throw error;
  }
};

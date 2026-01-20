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
  
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/periodic-calendar-sync.js:start',message:'Periodic sync started',data:{timestamp:new Date().toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  
  try {
    // Get all connected calendars
    const calendars = await db.Calendar.findAll({
      where: {
        recallId: { [db.Sequelize.Op.ne]: null },
      },
    });

    console.log(`[PERIODIC-SYNC] Found ${calendars.length} connected calendar(s)`);
    
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/periodic-calendar-sync.js:calendars_found',message:'Calendars found for sync',data:{calendarsCount:calendars.length,calendarEmails:calendars.map(c=>({id:c.id,email:c.email,recallId:c.recallId,status:c.status})),hasGeneCalendar:calendars.some(c=>c.email&&c.email.includes('gene@tin.info'))},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

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
        const isGeneCalendar = calendar.email && calendar.email.includes('gene@tin.info');
        
        // #region agent log
        if (isGeneCalendar) {
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/periodic-calendar-sync.js:gene_calendar_found',message:'Gene calendar found in periodic sync',data:{calendarId:calendar.id,email:calendar.email,recallId:calendar.recallId,status:calendar.status,lastUpdatedTimestamp:lastUpdatedTimestamp.toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-1',hypothesisId:'A'})}).catch(()=>{});
        }
        // #endregion
        
        console.log(
          `[PERIODIC-SYNC] Syncing calendar ${calendar.id} (${calendar.email || calendar.platform}) since ${lastUpdatedTimestamp.toISOString()}`
        );

        // #region agent log
        if (isGeneCalendar) {
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/periodic-calendar-sync.js:before_fetch',message:'Before fetching events from Recall API',data:{calendarId:calendar.id,recallId:calendar.recallId,lastUpdatedTimestamp:lastUpdatedTimestamp.toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-1',hypothesisId:'E'})}).catch(()=>{});
        }
        // #endregion

        const events = await Recall.fetchCalendarEvents({
          id: calendar.recallId,
          lastUpdatedTimestamp: lastUpdatedTimestamp.toISOString(),
        });

        // #region agent log
        if (isGeneCalendar) {
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/periodic-calendar-sync.js:after_fetch',message:'After fetching events from Recall API',data:{calendarId:calendar.id,eventsCount:events.length,eventIds:events.slice(0,5).map(e=>e.id),eventTitles:events.slice(0,5).map(e=>e.title||e.raw?.subject||'Untitled')},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-1',hypothesisId:'E'})}).catch(()=>{});
        }
        // #endregion

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
            
            // #region agent log
            if (isGeneCalendar && created) {
              fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/periodic-calendar-sync.js:event_created',message:'New event created in database',data:{eventId:event.id,recallEventId:event.id,title:event.title||event.raw?.subject||'Untitled',startTime:event.start_time,calendarId:calendar.id},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-1',hypothesisId:'E'})}).catch(()=>{});
            }
            // #endregion
            
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
        
        // #region agent log
        if (isGeneCalendar) {
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/periodic-calendar-sync.js:sync_complete',message:'Calendar sync completed',data:{calendarId:calendar.id,eventsUpserted:eventsUpserted.length,eventsDeleted:eventsDeleted.length,totalEventsFromRecall:events.length},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-1',hypothesisId:'D'})}).catch(()=>{});
        }
        // #endregion

        // Update auto-record status for ALL synced events (not just new ones)
        // This ensures events that were synced before but never had auto-record run get processed
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

          // Queue bot scheduling jobs ONLY for events that should be recorded
          let scheduledCount = 0;
          for (const event of dbEvents) {
            if (event.shouldRecordAutomatic || event.shouldRecordManual) {
              await backgroundQueue.add("calendarevent.update_bot_schedule", {
                calendarId: calendar.id,
                recallEventId: event.recallId,
              });
              scheduledCount++;
            }
          }

          console.log(
            `[PERIODIC-SYNC] Queued ${scheduledCount} bot scheduling job(s) for calendar ${calendar.id} (${dbEvents.length} events checked)`
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
        
        // #region agent log
        if (calendar.email && calendar.email.includes('gene@tin.info')) {
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/periodic-calendar-sync.js:sync_error',message:'Error syncing gene calendar',data:{calendarId:calendar.id,errorMessage:error.message,errorStack:error.stack,recallId:calendar.recallId},timestamp:Date.now(),sessionId:'debug-session',runId:'sync-1',hypothesisId:'E'})}).catch(()=>{});
        }
        // #endregion
        
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

/**
 * Diagnostic endpoint to check why bots aren't being scheduled.
 * 
 * GET /api/diagnose-bot-scheduling
 * 
 * This endpoint checks:
 * 1. Calendar settings (autoRecordExternalEvents, autoRecordInternalEvents)
 * 2. Events in local database vs Recall
 * 3. Why specific events don't have bots scheduled
 */

import db from "../../db.js";
import Recall from "../../services/recall/index.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.authentication.user.id;
    
    // Get all calendars for this user
    const calendars = await db.Calendar.findAll({
      where: { userId },
    });

    const diagnosis = {
      calendars: [],
      summary: {
        totalCalendars: calendars.length,
        issues: [],
        recommendations: [],
      },
    };

    for (const calendar of calendars) {
      const calendarDiagnosis = {
        id: calendar.id,
        platform: calendar.platform,
        email: calendar.email,
        recallId: calendar.recallId,
        status: calendar.status,
        settings: {
          autoRecordExternalEvents: calendar.autoRecordExternalEvents,
          autoRecordInternalEvents: calendar.autoRecordInternalEvents,
          autoRecordOnlyConfirmedEvents: calendar.autoRecordOnlyConfirmedEvents,
        },
        localEvents: { total: 0, withBots: 0, withoutBots: 0, future: 0 },
        recallEvents: { total: 0, withBots: 0, withoutBots: 0, future: 0 },
        eventsMissingLocally: [],
        eventsAnalysis: [],
        issues: [],
      };

      // Get local events
      const localEvents = await db.CalendarEvent.findAll({
        where: { calendarId: calendar.id },
        order: [["createdAt", "DESC"]],
      });

      const now = new Date();
      calendarDiagnosis.localEvents.total = localEvents.length;
      
      for (const event of localEvents) {
        const isFuture = event.startTime > now;
        if (isFuture) calendarDiagnosis.localEvents.future++;
        
        const hasBots = (event.recallData?.bots || []).length > 0;
        if (hasBots) {
          calendarDiagnosis.localEvents.withBots++;
        } else {
          calendarDiagnosis.localEvents.withoutBots++;
        }
      }

      // Get events from Recall API
      let recallEvents = [];
      try {
        recallEvents = await Recall.fetchCalendarEvents({
          id: calendar.recallId,
          lastUpdatedTimestamp: null,
        });
      } catch (err) {
        calendarDiagnosis.issues.push(`Failed to fetch Recall events: ${err.message}`);
      }

      calendarDiagnosis.recallEvents.total = recallEvents.length;
      
      const localEventRecallIds = new Set(localEvents.map(e => e.recallId));
      
      for (const recallEvent of recallEvents) {
        const startTime = new Date(recallEvent.start_time);
        const isFuture = startTime > now;
        if (isFuture) calendarDiagnosis.recallEvents.future++;
        
        const hasBots = (recallEvent.bots || []).length > 0;
        if (hasBots) {
          calendarDiagnosis.recallEvents.withBots++;
        } else {
          calendarDiagnosis.recallEvents.withoutBots++;
        }

        // Check if event is missing locally
        if (!localEventRecallIds.has(recallEvent.id)) {
          calendarDiagnosis.eventsMissingLocally.push({
            recallId: recallEvent.id,
            subject: recallEvent.raw?.subject || recallEvent.raw?.summary,
            startTime: recallEvent.start_time,
            hasMeetingUrl: !!recallEvent.meeting_url,
          });
        }

        // Analyze why future events without bots don't have bots
        if (isFuture && !hasBots && recallEvent.meeting_url) {
          const attendees = recallEvent.raw?.attendees || [];
          const calendarEmail = calendar.email?.toLowerCase();
          const calendarDomain = calendarEmail?.split("@")[1];
          
          let isExternal = false;
          let isInternal = true;
          
          for (const attendee of attendees) {
            const email = (attendee.emailAddress?.address || attendee.email || "").toLowerCase();
            const domain = email.split("@")[1];
            if (domain && domain !== calendarDomain) {
              isExternal = true;
              isInternal = false;
              break;
            }
          }

          const wouldRecord = 
            (calendar.autoRecordExternalEvents && isExternal) ||
            (calendar.autoRecordInternalEvents && !isExternal);

          calendarDiagnosis.eventsAnalysis.push({
            recallId: recallEvent.id,
            subject: recallEvent.raw?.subject || recallEvent.raw?.summary,
            startTime: recallEvent.start_time,
            isExternal,
            isInternal: !isExternal,
            attendeeEmails: attendees.map(a => a.emailAddress?.address || a.email).filter(Boolean),
            calendarDomain,
            wouldRecord,
            reason: wouldRecord 
              ? "Should be recorded (check if event is synced locally)"
              : isExternal 
                ? "External event but autoRecordExternalEvents is OFF"
                : "Internal event but autoRecordInternalEvents is OFF",
          });
        }
      }

      // Add issues
      if (!calendar.autoRecordExternalEvents && !calendar.autoRecordInternalEvents) {
        calendarDiagnosis.issues.push("Both autoRecordExternalEvents and autoRecordInternalEvents are OFF - no events will be auto-recorded");
      } else if (!calendar.autoRecordInternalEvents) {
        calendarDiagnosis.issues.push("autoRecordInternalEvents is OFF - internal meetings (same domain) won't be recorded");
      } else if (!calendar.autoRecordExternalEvents) {
        calendarDiagnosis.issues.push("autoRecordExternalEvents is OFF - external meetings won't be recorded");
      }

      if (calendarDiagnosis.eventsMissingLocally.length > 0) {
        calendarDiagnosis.issues.push(`${calendarDiagnosis.eventsMissingLocally.length} events exist in Recall but not synced locally`);
      }

      diagnosis.calendars.push(calendarDiagnosis);
    }

    // Generate summary
    for (const cal of diagnosis.calendars) {
      diagnosis.summary.issues.push(...cal.issues.map(i => `[${cal.email}] ${i}`));
    }

    if (diagnosis.summary.issues.some(i => i.includes("autoRecordInternalEvents is OFF"))) {
      diagnosis.summary.recommendations.push(
        "Enable 'Record Internal Events' in calendar settings to record meetings with same-domain attendees"
      );
    }

    if (diagnosis.summary.issues.some(i => i.includes("not synced locally"))) {
      diagnosis.summary.recommendations.push(
        "Trigger a calendar sync to pull latest events from Recall"
      );
    }

    return res.json(diagnosis);
  } catch (error) {
    console.error("[DIAGNOSE-BOT-SCHEDULING] Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
};


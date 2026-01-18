import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { updateAutoRecordStatusForCalendarEvents } from "../../logic/autorecord.js";
import { telemetryEvent } from "../../utils/telemetry.js";

export default async (job) => {
  const { calendarId, recallEventIds } = job.data;
  const [calendar, events] = await Promise.all([
    db.Calendar.findByPk(calendarId),
    db.CalendarEvent.findAll({
      where: {
        recallId: {
          [db.Sequelize.Op.in]: recallEventIds,
        },
      },
    }),
  ]);

  await updateAutoRecordStatusForCalendarEvents({ calendar, events });
  console.log(
    `INFO: Updated auto record status for ${events.length} events for calendar ${calendarId}`
  );

  // queue up bot schedule updates
  telemetryEvent(
    "Autorecord.queue_bot_scheduling",
    { calendarId, eventCount: events.length },
    { location: "worker/processors/calendar-events-update-autorecord.js:queue" }
  );
  events.forEach((event) => {
    backgroundQueue.add("calendarevent.update_bot_schedule", {
      calendarId,
      recallEventId: event.recallId,
    }).catch((err) => {
      telemetryEvent(
        "Autorecord.queue_bot_scheduling_failed",
        { calendarId, recallEventId: event.recallId, errorMessage: err.message },
        { location: "worker/processors/calendar-events-update-autorecord.js:queue_failed" }
      );
    });
  });
};

import db from "../../db.js";

export default async (job) => {
  const { calendarId, event, payload } = job.data;
  try {
    const calendarWebhook = await db.CalendarWebhook.create({
      calendarId,
      event,
      payload,
      receivedAt: new Date(),
    });
    console.log(
      `INFO: Recorded calendar webhook: ${JSON.stringify(calendarWebhook)}`
    );
  } catch (error) {
    console.error(`[WEBHOOK-SAVE] Failed to save webhook:`, error);
    throw error; // Re-throw to mark job as failed
  }
};

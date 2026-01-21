import { backgroundQueue } from "../queue.js";

/**
 * Queue a bot scheduling job with deduplication.
 * Uses jobId to prevent duplicate jobs for the same event.
 * 
 * @param {string} recallEventId - The Recall event ID
 * @param {string} calendarId - The calendar ID (optional, for logging)
 * @returns {Promise} The queued job
 */
export async function queueBotScheduleJob(recallEventId, calendarId = null) {
  // Use jobId to prevent duplicate bot scheduling jobs for the same event
  const jobId = `bot-schedule-${recallEventId}`;
  
  try {
    return await backgroundQueue.add(
      "calendarevent.update_bot_schedule",
      {
        calendarId,
        recallEventId,
      },
      {
        jobId, // This prevents duplicate jobs - if a job with this ID exists, it won't be added again
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  } catch (err) {
    // If job already exists, that's okay - it means a bot scheduling job is already queued
    if (err.message?.includes("already exists") || err.code === "DUPLICATE_JOB") {
      console.log(`[BOT-SCHEDULE] Job already queued for event ${recallEventId}`);
      // Return the existing job
      return await backgroundQueue.getJob(jobId);
    }
    throw err;
  }
}


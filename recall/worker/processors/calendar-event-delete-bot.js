import Recall from "../../services/recall/index.js";

// remove bot for deleted calendar event
export default async (job) => {
  const { recallEventId } = job.data;
  const jobId = job.id || job.opts?.jobId || 'unknown';
  console.log(`[BOT-DELETE] 🚀 Processing bot deletion job: eventId=${recallEventId} jobId=${jobId}`);
  
  try {
    await Recall.removeBotFromCalendarEvent({
      id: recallEventId,
    });
    console.log(`[BOT-DELETE] ✅ Bot deletion completed: eventId=${recallEventId}`);
  } catch (error) {
    // Handle 409 conflict gracefully - this means deduplication is working correctly
    if (error.message?.includes('status 409') || error.message?.includes('conflict')) {
      console.log(`[BOT-DELETE] Bot deletion deduplicated (409 conflict) for event ${recallEventId} - another request is in progress`);
      return; // Don't throw - this is expected behavior
    }
    console.error(`[BOT-DELETE] ❌ Failed to delete bot for event ${recallEventId}:`, error.message);
    throw error; // Re-throw to mark job as failed
  }
};

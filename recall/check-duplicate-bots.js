import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { connect as connectDb } from "./db.js";

async function checkDuplicateBots() {
  await connectDb();
  
  console.log("🔍 Checking for duplicate bot scheduling...\n");
  
  // Find recent meetings with multiple bots
  const recentMeetings = await db.MeetingArtifact.findAll({
    where: {
      createdAt: {
        [db.Sequelize.Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    },
    include: [
      {
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      },
    ],
    order: [["createdAt", "DESC"]],
    limit: 20,
  });
  
  console.log(`Found ${recentMeetings.length} recent meetings\n`);
  
  for (const meeting of recentMeetings) {
    const event = meeting.CalendarEvent;
    if (!event) continue;
    
    // Check Recall API for bots on this event
    const Recall = (await import("./services/recall/index.js")).default;
    try {
      const recallEvent = await Recall.getCalendarEvent(event.recallId);
      const bots = recallEvent?.bots || [];
      
      if (bots.length > 1) {
        console.log(`⚠️  DUPLICATE BOTS FOUND:`);
        console.log(`   Meeting: ${meeting.readableId || meeting.id}`);
        console.log(`   Event ID: ${event.recallId}`);
        console.log(`   Start Time: ${event.startTime}`);
        console.log(`   Bot Count: ${bots.length}`);
        console.log(`   Bot IDs: ${bots.map(b => b.id).join(", ")}`);
        console.log(`   Calendar: ${event.Calendar?.email || event.Calendar?.id}\n`);
      }
    } catch (err) {
      console.log(`   Error checking event ${event.recallId}: ${err.message}`);
    }
  }
  
  // Check for duplicate bot scheduling jobs in the queue
  console.log("\n🔍 Checking for duplicate bot scheduling jobs...\n");
  
  const { backgroundQueue } = await import("./queue.js");
  
  const waitingJobs = await backgroundQueue.getWaiting();
  const activeJobs = await backgroundQueue.getActive();
  
  const botScheduleJobs = [...waitingJobs, ...activeJobs].filter(
    (j) => j.name === "calendarevent.update_bot_schedule"
  );
  
  // Group by recallEventId
  const jobsByEvent = {};
  for (const job of botScheduleJobs) {
    const recallEventId = job.data?.recallEventId;
    if (!recallEventId) continue;
    
    if (!jobsByEvent[recallEventId]) {
      jobsByEvent[recallEventId] = [];
    }
    jobsByEvent[recallEventId].push(job);
  }
  
  // Find duplicates
  const duplicates = Object.entries(jobsByEvent).filter(
    ([_, jobs]) => jobs.length > 1
  );
  
  if (duplicates.length > 0) {
    console.log(`⚠️  Found ${duplicates.length} events with duplicate bot scheduling jobs:\n`);
    for (const [recallEventId, jobs] of duplicates) {
      console.log(`   Event: ${recallEventId}`);
      console.log(`   Job Count: ${jobs.length}`);
      console.log(`   Job IDs: ${jobs.map(j => j.id).join(", ")}`);
      console.log(`   States: ${jobs.map(j => j.opts?.jobId || 'no-id').join(", ")}\n`);
    }
  } else {
    console.log("✅ No duplicate bot scheduling jobs found in queue\n");
  }
  
  process.exit(0);
}

checkDuplicateBots().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});


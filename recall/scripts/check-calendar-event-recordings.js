import db, { connect as connectDb } from "../db.js";
import Recall from "../services/recall/index.js";

async function checkCalendarEventRecordings() {
  try {
    await connectDb();
    Recall.initialize();
    
    // Find recent meetings with recallEventId
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const artifacts = await db.MeetingArtifact.findAll({
      where: {
        recallEventId: { [db.Sequelize.Op.ne]: null },
        createdAt: { [db.Sequelize.Op.gte]: threeDaysAgo },
      },
      limit: 10,
      order: [["createdAt", "DESC"]],
      include: [{
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      }],
    });

    console.log(`\n🔍 Checking ${artifacts.length} meetings with recallEventId\n`);

    for (const artifact of artifacts) {
      const title = artifact.CalendarEvent?.title || artifact.id;
      const recallEventId = artifact.recallEventId;
      const calendarId = artifact.CalendarEvent?.Calendar?.recallId;
      
      console.log(`\n📅 ${title}`);
      console.log(`   Artifact ID: ${artifact.id}`);
      console.log(`   Recall Event ID: ${recallEventId}`);
      console.log(`   Calendar ID: ${calendarId}`);
      
      if (calendarId && recallEventId) {
        try {
          // Try to get calendar event from Recall API
          console.log(`   Fetching calendar event from Recall API...`);
          const { getClient } = await import("../services/recall/api-client.js");
          const client = getClient();
          
          // Try to get the calendar event
          const event = await client.request({
            path: `/api/v2/calendar-events/${recallEventId}/`,
            method: "GET",
          });
          
          console.log(`   ✅ Got calendar event!`);
          console.log(`      Event keys: ${Object.keys(event).join(", ")}`);
          
          // Check if event has bots with recordings
          if (event.bots && Array.isArray(event.bots) && event.bots.length > 0) {
            console.log(`      Found ${event.bots.length} bot(s)`);
            for (const bot of event.bots) {
              console.log(`\n         Bot ${bot.id}:`);
              console.log(`            Status: ${bot.status || "Unknown"}`);
              console.log(`            Bot keys: ${Object.keys(bot).join(", ")}`);
              
              const urls = Recall.getRecordingUrlsFromBot(bot);
              console.log(`            Video URL: ${urls.videoUrl || "None"}`);
              console.log(`            Audio URL: ${urls.audioUrl || "None"}`);
              
              if (urls.videoUrl || urls.audioUrl) {
                console.log(`         ✅ HAS RECORDING!`);
                
                // Update artifact
                await artifact.update({
                  sourceRecordingUrl: urls.videoUrl || urls.audioUrl,
                  rawPayload: {
                    ...artifact.rawPayload,
                    data: {
                      ...artifact.rawPayload?.data,
                      video_url: urls.videoUrl,
                      audio_url: urls.audioUrl,
                      recording_url: urls.videoUrl || urls.audioUrl,
                      recordings: bot.recordings,
                      media_shortcuts: bot.recordings?.[0]?.media_shortcuts || bot.media_shortcuts,
                    },
                  },
                });
                console.log(`         ✅ Updated artifact!`);
                console.log(`            Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
              } else {
                // Check bot structure more deeply
                console.log(`            Bot structure:`, JSON.stringify(bot, null, 2).substring(0, 500));
              }
            }
          } else {
            console.log(`      No bots found in calendar event`);
          }
        } catch (error) {
          if (error.message.includes('404')) {
            console.log(`   ❌ Calendar event not found (404)`);
          } else {
            console.log(`   ❌ Error: ${error.message}`);
          }
        }
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

checkCalendarEventRecordings();


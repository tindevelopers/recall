import db, { connect as connectDb } from "../db.js";
import Recall from "../services/recall/index.js";

async function checkCachedRecordings() {
  try {
    await connectDb();
    Recall.initialize();
    
    // Find recent meetings (last 3 days)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const artifacts = await db.MeetingArtifact.findAll({
      where: {
        createdAt: { [db.Sequelize.Op.gte]: threeDaysAgo },
      },
      limit: 20,
      order: [["createdAt", "DESC"]],
      include: [{
        model: db.CalendarEvent,
        attributes: ["title", "startTime"],
      }],
    });

    console.log(`\n🔍 Checking ${artifacts.length} recent meetings for cached recordings\n`);

    let foundRecordings = [];

    for (const artifact of artifacts) {
      const title = artifact.CalendarEvent?.title || artifact.id;
      
      // Check for cached recording URLs
      const videoUrl = 
        artifact.archivedRecordingUrl ||
        artifact.sourceRecordingUrl ||
        artifact.rawPayload?.data?.video_url ||
        artifact.rawPayload?.data?.recording_url ||
        artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
        null;
      
      const audioUrl = 
        artifact.rawPayload?.data?.audio_url ||
        artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url ||
        null;
      
      if (videoUrl || audioUrl) {
        foundRecordings.push({ artifact, title, videoUrl, audioUrl });
        console.log(`✅ ${title}`);
        console.log(`   ID: ${artifact.id}`);
        console.log(`   Video: ${videoUrl || "None"}`);
        console.log(`   Audio: ${audioUrl || "None"}`);
        console.log(`   URL: http://localhost:3003/meetings/${artifact.id}`);
        console.log(``);
      }
    }
    
    if (foundRecordings.length === 0) {
      console.log(`❌ No cached recordings found in recent meetings`);
      console.log(`\n📡 Checking active bots from Recall API...`);
      
      try {
        const activeBots = await Recall.listBots({ status: "completed", limit: 10 });
        console.log(`   Found ${activeBots.length} completed bots`);
        
        for (const bot of activeBots.slice(0, 5)) {
          console.log(`\n   Bot: ${bot.id}`);
          console.log(`      Status: ${bot.status}`);
          console.log(`      Created: ${bot.created_at || bot.createdAt}`);
          
          const urls = Recall.getRecordingUrlsFromBot(bot);
          if (urls.videoUrl || urls.audioUrl) {
            console.log(`      ✅ HAS RECORDING!`);
            console.log(`         Video: ${urls.videoUrl || "None"}`);
            console.log(`         Audio: ${urls.audioUrl || "None"}`);
          }
        }
      } catch (error) {
        console.log(`   Error listing bots: ${error.message}`);
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

checkCachedRecordings();


import db, { connect as connectDb } from "../db.js";
import Recall from "../services/recall/index.js";

async function findRecentRecordings() {
  try {
    await connectDb();
    Recall.initialize();
    
    // Find recent meetings with bot IDs (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const artifacts = await db.MeetingArtifact.findAll({
      where: {
        recallBotId: { [db.Sequelize.Op.ne]: null },
        createdAt: { [db.Sequelize.Op.gte]: sevenDaysAgo },
      },
      limit: 10,
      order: [["createdAt", "DESC"]],
      include: [{
        model: db.CalendarEvent,
        attributes: ["title", "startTime"],
      }],
    });

    console.log(`\n🔍 Found ${artifacts.length} recent meetings with bots\n`);

    for (const artifact of artifacts) {
      const title = artifact.CalendarEvent?.title || artifact.id;
      const startTime = artifact.CalendarEvent?.startTime || artifact.createdAt;
      console.log(`\n📅 Meeting: ${title}`);
      console.log(`   ID: ${artifact.id}`);
      console.log(`   Bot ID: ${artifact.recallBotId}`);
      console.log(`   Start: ${startTime}`);
      
      // Try to fetch bot data
      try {
        console.log(`   Fetching bot data...`);
        const urls = await Recall.getBotRecordingUrls(artifact.recallBotId);
        
        if (urls.videoUrl || urls.audioUrl) {
          console.log(`   ✅ FOUND RECORDING!`);
          console.log(`      Video: ${urls.videoUrl || "None"}`);
          console.log(`      Audio: ${urls.audioUrl || "None"}`);
          console.log(`      Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
          
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
                recordings: urls.bot?.recordings,
                media_shortcuts: urls.bot?.recordings?.[0]?.media_shortcuts,
              },
            },
          });
          console.log(`      ✅ Updated artifact with recording URLs`);
        } else {
          console.log(`   ⚠️  Bot found but no recording URLs`);
        }
      } catch (error) {
        if (error.message.includes('404')) {
          console.log(`   ❌ Bot not found (404) - may have been deleted`);
        } else {
          console.log(`   ❌ Error: ${error.message}`);
        }
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

findRecentRecordings();


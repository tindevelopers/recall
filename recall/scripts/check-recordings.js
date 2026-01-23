import db, { connect as connectDb } from "../db.js";
import Recall from "../services/recall/index.js";
import { Op } from "sequelize";

async function checkRecordings() {
  try {
    // Connect to database
    await connectDb();
    
    // Initialize Recall service
    Recall.initialize();
    
    // Find meetings with bot IDs
    const artifacts = await db.MeetingArtifact.findAll({
      where: {
        recallBotId: { [Op.ne]: null },
      },
      limit: 20,
      order: [["createdAt", "DESC"]],
      attributes: [
        "id",
        "recallBotId",
        "archivedRecordingUrl",
        "sourceRecordingUrl",
        "rawPayload",
      ],
      include: [{
        model: db.CalendarEvent,
        attributes: ["title"],
      }],
    });

    console.log(`Found ${artifacts.length} meetings with bot IDs\n`);

    let meetingsWithRecordings = [];

    for (const artifact of artifacts) {
      const title = artifact.CalendarEvent?.title || 
                    artifact.rawPayload?.data?.title || 
                    artifact.id;
      
      // Check for recordings in rawPayload first
      const rawVideoUrl = 
        artifact.rawPayload?.data?.video_url || 
        artifact.rawPayload?.data?.recording_url ||
        artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
        artifact.rawPayload?.media_shortcuts?.video?.data?.download_url ||
        null;
      const rawAudioUrl = 
        artifact.rawPayload?.data?.audio_url ||
        artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url ||
        artifact.rawPayload?.media_shortcuts?.audio?.data?.download_url ||
        null;
      
      const hasRecording = !!(
        artifact.archivedRecordingUrl ||
        artifact.sourceRecordingUrl ||
        rawVideoUrl ||
        rawAudioUrl
      );

      if (hasRecording) {
        meetingsWithRecordings.push({
          id: artifact.id,
          title,
          botId: artifact.recallBotId,
          videoUrl: artifact.archivedRecordingUrl || artifact.sourceRecordingUrl || rawVideoUrl,
          audioUrl: rawAudioUrl,
        });
        
        console.log(`✅ Meeting: ${title}`);
        console.log(`   ID: ${artifact.id}`);
        console.log(`   Bot ID: ${artifact.recallBotId}`);
        console.log(`   Video URL: ${artifact.archivedRecordingUrl || artifact.sourceRecordingUrl || rawVideoUrl ? "Yes" : "No"}`);
        console.log(`   Audio URL: ${rawAudioUrl ? "Yes" : "No"}`);
        console.log(`   URL: http://localhost:3003/meetings/${artifact.id}`);
        console.log("");
      }
    }

    if (meetingsWithRecordings.length === 0) {
      console.log("❌ No meetings with recordings found in database");
      console.log("   Checking rawPayload for recordings...\n");
      
      // Try fetching from API for first few
      for (const artifact of artifacts.slice(0, 5)) {
        const title = artifact.CalendarEvent?.title || 
                      artifact.rawPayload?.data?.title || 
                      artifact.id;
        console.log(`Checking bot ${artifact.recallBotId} for ${title}...`);
        
        try {
          const bot = await Recall.getBot(artifact.recallBotId);
          const recordings = bot?.recordings || [];
          
          if (recordings.length > 0) {
            const videoUrl =
              recordings[0]?.media_shortcuts?.video?.data?.download_url ||
              recordings[0]?.video_url ||
              null;
            
            if (videoUrl) {
              console.log(`  ✅ Found recording via API!`);
              console.log(`     Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
              meetingsWithRecordings.push({
                id: artifact.id,
                title,
                botId: artifact.recallBotId,
                videoUrl,
              });
              break; // Found one, stop checking
            }
          }
        } catch (error) {
          // Skip 404 errors
          if (!error.message.includes('404')) {
            console.log(`  ⚠️  Error: ${error.message}`);
          }
        }
      }
    }

    if (meetingsWithRecordings.length > 0) {
      console.log(`\n🎉 Found ${meetingsWithRecordings.length} meeting(s) with recordings!`);
      console.log(`   First meeting: ${meetingsWithRecordings[0].title}`);
      console.log(`   URL: http://localhost:3003/meetings/${meetingsWithRecordings[0].id}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkRecordings();


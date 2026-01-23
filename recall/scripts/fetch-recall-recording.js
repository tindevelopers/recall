import db, { connect as connectDb } from "../db.js";
import Recall from "../services/recall/index.js";

async function fetchRecallRecording() {
  try {
    await connectDb();
    Recall.initialize();
    
    // Find the PetJet meeting artifact
    const artifact = await db.MeetingArtifact.findOne({
      where: { id: "54d68780-2141-43f5-b1ce-1a4b18f222e3" },
      include: [{
        model: db.CalendarEvent,
        attributes: ["title"],
      }],
    });

    if (!artifact) {
      console.log("❌ Meeting artifact not found");
      process.exit(1);
    }

    const botId = artifact.recallBotId;
    if (!botId) {
      console.log("❌ No bot ID found for this meeting");
      process.exit(1);
    }

    console.log(`\n🔍 Fetching Recall recording for bot: ${botId}`);
    console.log(`   Meeting: ${artifact.CalendarEvent?.title || "Unknown"}`);
    
    // Try v1 API first (more reliable for older bots)
    console.log(`\n📡 Trying v1 API...`);
    try {
      const botV1 = await Recall.getClient().request({
        path: `/api/v1/bot/${botId}/`,
        method: "GET",
      });
      
      console.log(`✅ v1 API Success!`);
      console.log(`   Bot status: ${botV1.status || "Unknown"}`);
      console.log(`   Recordings count: ${botV1.recordings?.length || 0}`);
      
      if (botV1.recordings && botV1.recordings.length > 0) {
        console.log(`\n📹 Recording details:`);
        botV1.recordings.forEach((recording, idx) => {
          console.log(`\n   Recording ${idx + 1}:`);
          const videoUrl = recording?.media_shortcuts?.video?.data?.download_url;
          const audioUrl = recording?.media_shortcuts?.audio?.data?.download_url;
          console.log(`     Video URL: ${videoUrl || "None"}`);
          console.log(`     Audio URL: ${audioUrl || "None"}`);
          if (videoUrl || audioUrl) {
            console.log(`     ✅ Found media URLs!`);
          }
        });
        
        // Extract URLs using the service method
        const urls = Recall.getRecordingUrlsFromBot(botV1);
        console.log(`\n🎯 Extracted URLs:`);
        console.log(`   Video: ${urls.videoUrl || "None"}`);
        console.log(`   Audio: ${urls.audioUrl || "None"}`);
        console.log(`   Transcript: ${urls.transcriptUrl || "None"}`);
        
        if (urls.videoUrl || urls.audioUrl) {
          console.log(`\n💾 Updating artifact with recording URLs...`);
          await artifact.update({
            sourceRecordingUrl: urls.videoUrl || urls.audioUrl,
            rawPayload: {
              ...artifact.rawPayload,
              data: {
                ...artifact.rawPayload?.data,
                video_url: urls.videoUrl,
                audio_url: urls.audioUrl,
                recording_url: urls.videoUrl || urls.audioUrl,
                recordings: botV1.recordings,
                media_shortcuts: botV1.recordings?.[0]?.media_shortcuts,
              },
            },
          });
          console.log(`✅ Updated artifact!`);
          console.log(`   Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
          process.exit(0);
        }
      } else {
        console.log(`   No recordings found in v1 API response`);
        console.log(`   Bot keys: ${Object.keys(botV1).join(", ")}`);
      }
    } catch (v1Error) {
      console.log(`❌ v1 API failed: ${v1Error.message}`);
      if (v1Error.message.includes('404')) {
        console.log(`   Bot may have been deleted or expired`);
      }
    }
    
    // Try v2 API
    console.log(`\n📡 Trying v2 API...`);
    try {
      const urls = await Recall.getBotRecordingUrls(botId);
      console.log(`✅ v2 API Success!`);
      console.log(`   Video URL: ${urls.videoUrl || "None"}`);
      console.log(`   Audio URL: ${urls.audioUrl || "None"}`);
      console.log(`   Transcript URL: ${urls.transcriptUrl || "None"}`);
      
      if (urls.videoUrl || urls.audioUrl) {
        console.log(`\n💾 Updating artifact with recording URLs...`);
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
        console.log(`✅ Updated artifact!`);
        console.log(`   Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
        process.exit(0);
      }
    } catch (v2Error) {
      console.log(`❌ v2 API failed: ${v2Error.message}`);
    }
    
    // Try dedicated recording endpoint
    console.log(`\n📡 Trying recording endpoint...`);
    try {
      const recording = await Recall.getBotRecording(botId);
      console.log(`✅ Recording endpoint Success!`);
      console.log(`   Recording data:`, JSON.stringify(recording, null, 2));
    } catch (recError) {
      console.log(`❌ Recording endpoint failed: ${recError.message}`);
    }
    
    console.log(`\n❌ Could not find recording URLs for bot ${botId}`);
    process.exit(1);
  } catch (error) {
    console.error("❌ Error:", error);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

fetchRecallRecording();


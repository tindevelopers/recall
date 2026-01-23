import db, { connect as connectDb } from "../db.js";
import Recall from "../services/recall/index.js";
import { Op } from "sequelize";

async function findPetJetRecording() {
  try {
    await connectDb();
    Recall.initialize();
    
    // Find the PetJet meeting
    const artifact = await db.MeetingArtifact.findOne({
      where: {
        id: "54d68780-2141-43f5-b1ce-1a4b18f222e3",
      },
      include: [{
        model: db.CalendarEvent,
        attributes: ["title"],
      }],
    });

    if (!artifact) {
      console.log("❌ Meeting not found");
      process.exit(1);
    }

    const title = artifact.CalendarEvent?.title || artifact.rawPayload?.data?.title || artifact.id;
    console.log(`\n🔍 Checking meeting: ${title}`);
    console.log(`   ID: ${artifact.id}`);
    console.log(`   Bot ID: ${artifact.recallBotId}`);
    console.log(`   Archived Recording URL: ${artifact.archivedRecordingUrl || "None"}`);
    console.log(`   Source Recording URL: ${artifact.sourceRecordingUrl || "None"}`);
    
    // Check rawPayload structure
    console.log(`\n📦 RawPayload structure:`);
    if (artifact.rawPayload) {
      console.log(`   Keys: ${Object.keys(artifact.rawPayload).join(", ")}`);
      
      if (artifact.rawPayload.data) {
        console.log(`   Data keys: ${Object.keys(artifact.rawPayload.data).join(", ")}`);
        
        // Check for video URLs
        const videoUrl = artifact.rawPayload.data.video_url;
        const recordingUrl = artifact.rawPayload.data.recording_url;
        const audioUrl = artifact.rawPayload.data.audio_url;
        
        console.log(`\n   Video URL: ${videoUrl || "None"}`);
        console.log(`   Recording URL: ${recordingUrl || "None"}`);
        console.log(`   Audio URL: ${audioUrl || "None"}`);
        
        // Check media_shortcuts
        if (artifact.rawPayload.data.media_shortcuts) {
          console.log(`\n   Media Shortcuts:`);
          console.log(`     Keys: ${Object.keys(artifact.rawPayload.data.media_shortcuts).join(", ")}`);
          
          if (artifact.rawPayload.data.media_shortcuts.video) {
            console.log(`     Video:`, JSON.stringify(artifact.rawPayload.data.media_shortcuts.video, null, 2));
          }
          if (artifact.rawPayload.data.media_shortcuts.audio) {
            console.log(`     Audio:`, JSON.stringify(artifact.rawPayload.data.media_shortcuts.audio, null, 2));
          }
        }
        
        // Check recordings array
        if (artifact.rawPayload.data.recordings) {
          console.log(`\n   Recordings array:`);
          if (Array.isArray(artifact.rawPayload.data.recordings)) {
            console.log(`     Length: ${artifact.rawPayload.data.recordings.length}`);
            artifact.rawPayload.data.recordings.forEach((rec, idx) => {
              console.log(`     Recording ${idx}:`, JSON.stringify(rec, null, 2));
            });
          } else {
            console.log(`     Type: ${typeof artifact.rawPayload.data.recordings}`);
            console.log(`     Value:`, JSON.stringify(artifact.rawPayload.data.recordings, null, 2));
          }
        }
        
        // Check for Teams/SharePoint URLs
        console.log(`\n   Teams/SharePoint URLs:`);
        console.log(`     teamsRecordingUrl: ${artifact.rawPayload.data.teamsRecordingUrl || "None"}`);
        console.log(`     teams_video_url: ${artifact.rawPayload.data.teams_video_url || "None"}`);
        console.log(`     sharePointRecordingUrl: ${artifact.rawPayload.data.sharePointRecordingUrl || "None"}`);
        
        // Full rawPayload dump for debugging
        console.log(`\n📋 Full rawPayload.data dump:`);
        console.log(JSON.stringify(artifact.rawPayload.data, null, 2));
      }
    }
    
    // Try fetching from Recall API if bot ID exists
    if (artifact.recallBotId) {
      console.log(`\n🌐 Fetching from Recall API for bot ${artifact.recallBotId}...`);
      try {
        const bot = await Recall.getBot(artifact.recallBotId);
        console.log(`   Bot status: ${bot?.status || "Unknown"}`);
        
        if (bot?.recordings && Array.isArray(bot.recordings) && bot.recordings.length > 0) {
          console.log(`   Found ${bot.recordings.length} recording(s)`);
          bot.recordings.forEach((rec, idx) => {
            console.log(`\n   Recording ${idx}:`);
            console.log(`     Video URL: ${rec.video_url || "None"}`);
            console.log(`     Audio URL: ${rec.audio_url || "None"}`);
            if (rec.media_shortcuts) {
              console.log(`     Media Shortcuts:`, JSON.stringify(rec.media_shortcuts, null, 2));
            }
          });
        } else {
          console.log(`   No recordings found in bot response`);
          console.log(`   Bot data keys: ${Object.keys(bot || {}).join(", ")}`);
        }
      } catch (error) {
        console.log(`   ❌ Error fetching from API: ${error.message}`);
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

findPetJetRecording();


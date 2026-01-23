import db, { connect as connectDb } from "../db.js";
import { fetchTeamsRecordingMetadata } from "../services/microsoft-graph/index.js";

async function fetchPetJetRecording() {
  try {
    await connectDb();
    
    // Find the PetJet meeting artifact
    const artifact = await db.MeetingArtifact.findOne({
      where: { id: "54d68780-2141-43f5-b1ce-1a4b18f222e3" },
      include: [{
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      }],
    });

    if (!artifact) {
      console.log("❌ Meeting artifact not found");
      process.exit(1);
    }

    const calendarEvent = artifact.CalendarEvent;
    if (!calendarEvent) {
      console.log("❌ Calendar event not found");
      process.exit(1);
    }

    console.log(`\n🔍 Fetching Teams recording for meeting:`);
    console.log(`   Title: ${calendarEvent.title}`);
    console.log(`   Meeting URL: ${calendarEvent.meetingUrl}`);
    console.log(`   Calendar: ${calendarEvent.Calendar?.email || "Unknown"}`);
    
    // Fetch Teams recording metadata
    console.log(`\n🌐 Fetching recording metadata from Microsoft Graph...`);
    const recordingMetadata = await fetchTeamsRecordingMetadata(calendarEvent);
    
    if (!recordingMetadata) {
      console.log(`❌ No recording metadata found`);
      process.exit(1);
    }

    console.log(`\n✅ Found recording metadata!`);
    console.log(`   Meeting ID: ${recordingMetadata.meetingId}`);
    console.log(`   User ID: ${recordingMetadata.userId}`);
    console.log(`   Recordings count: ${recordingMetadata.recordings?.length || 0}`);
    
    if (recordingMetadata.recordings && recordingMetadata.recordings.length > 0) {
      console.log(`\n📹 Recording details:`);
      recordingMetadata.recordings.forEach((recording, idx) => {
        console.log(`\n   Recording ${idx + 1}:`);
        console.log(`     ID: ${recording.id || recording.recordingId || "N/A"}`);
        console.log(`     Content: ${recording.contentDownloadUrl || recording.downloadUrl || "N/A"}`);
        console.log(`     Status: ${recording.status || "N/A"}`);
        console.log(`     Created: ${recording.createdDateTime || "N/A"}`);
        console.log(`     Full object:`, JSON.stringify(recording, null, 2));
      });
      
      // Try to update the artifact with the recording URL
      const firstRecording = recordingMetadata.recordings[0];
      const recordingUrl = firstRecording.contentDownloadUrl || 
                          firstRecording.downloadUrl || 
                          firstRecording.recordingContentUrl ||
                          null;
      
      if (recordingUrl) {
        console.log(`\n💾 Updating artifact with recording URL...`);
        await artifact.update({
          sourceRecordingUrl: recordingUrl,
          rawPayload: {
            ...artifact.rawPayload,
            data: {
              ...artifact.rawPayload?.data,
              teamsRecordingUrl: recordingUrl,
              teamsRecordingMetadata: recordingMetadata.recordings,
            },
          },
        });
        console.log(`✅ Updated artifact with recording URL: ${recordingUrl}`);
        console.log(`   Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
      } else {
        console.log(`⚠️  Recording found but no download URL available`);
      }
    } else {
      console.log(`❌ No recordings found in metadata`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

fetchPetJetRecording();


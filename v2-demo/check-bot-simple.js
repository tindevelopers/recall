// Simple script to check bot and notetaker status
import { getClient } from "./services/recall/api-client.js";
import db from "./db.js";
import dotenv from "dotenv";

dotenv.config();

const botId = "5f66e9ce-c2dd-4fc7-a667-09af82ca664d";

async function checkBot() {
  console.log(`🔍 Checking bot: ${botId}\n`);
  
  // Initialize Recall client
  const client = getClient();
  
  // Check database for meeting artifacts with this bot ID
  console.log("📊 Checking database for meeting artifacts...");
  const artifacts = await db.MeetingArtifact.findAll({
    where: { recallBotId: botId },
    include: [
      { model: db.CalendarEvent },
      { model: db.MeetingSummary },
    ],
    order: [["createdAt", "DESC"]],
    limit: 10,
  });
  
  if (artifacts.length > 0) {
    console.log(`✅ Found ${artifacts.length} meeting artifact(s) for this bot:\n`);
    artifacts.forEach((artifact, idx) => {
      console.log(`Artifact ${idx + 1}:`);
      console.log(`  - ID: ${artifact.id}`);
      console.log(`  - Event ID: ${artifact.recallEventId}`);
      console.log(`  - Bot ID: ${artifact.recallBotId}`);
      console.log(`  - Event Type: ${artifact.eventType}`);
      console.log(`  - Status: ${artifact.status}`);
      console.log(`  - Created: ${artifact.createdAt}`);
      
      // Check if transcript exists (indicates notetaker was invoked)
      const hasTranscript = artifact.rawPayload?.data?.transcript || 
                           artifact.rawPayload?.data?.transcript_segments ||
                           artifact.rawPayload?.transcript;
      
      if (hasTranscript) {
        const segments = artifact.rawPayload?.data?.transcript?.segments || 
                        artifact.rawPayload?.data?.transcript_segments ||
                        artifact.rawPayload?.transcript?.segments || [];
        console.log(`  - ✅ Notetaker INVOKED: Found ${segments.length} transcript segments`);
      } else {
        console.log(`  - ❌ Notetaker NOT invoked: No transcript found`);
      }
      console.log('');
    });
  } else {
    console.log(`❌ No meeting artifacts found for bot ID: ${botId}`);
    console.log(`\nThis could mean:`);
    console.log(`  1. Bot hasn't joined any meetings yet`);
    console.log(`  2. Webhooks haven't been received`);
    console.log(`  3. Bot ID is incorrect`);
  }
  
  // Try to get bot info from Recall API
  console.log("\n🌐 Checking Recall API...");
  try {
    // Try v2 endpoint
    const botInfo = await client.request({
      path: `/api/v2/bots/${botId}/`,
      method: "GET",
    });
    console.log("✅ Bot info from Recall API:");
    console.log(JSON.stringify(botInfo, null, 2));
  } catch (err) {
    console.log(`❌ Could not fetch bot info: ${err.message}`);
    console.log(`   (Bot endpoint may not be available in API)`);
  }
  
  await db.sequelize.close();
}

checkBot().catch(console.error);

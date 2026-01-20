// Check if bot invoked notetaker by querying database
import db from "./db.js";

const botId = "5f66e9ce-c2dd-4fc7-a667-09af82ca664d";

async function checkNotetaker() {
  console.log(`🔍 Checking if bot ${botId} invoked notetaker...\n`);
  
  try {
    // Find meeting artifacts for this bot
    const artifacts = await db.MeetingArtifact.findAll({
      where: { recallBotId: botId },
      order: [["createdAt", "DESC"]],
      limit: 20,
    });
    
    if (artifacts.length === 0) {
      console.log(`❌ No meeting artifacts found for bot ID: ${botId}`);
      console.log(`\nThis means:`);
      console.log(`  - Bot may not have joined any meetings yet`);
      console.log(`  - Webhooks may not have been received`);
      console.log(`  - Bot ID might be incorrect\n`);
      return;
    }
    
    console.log(`✅ Found ${artifacts.length} meeting artifact(s) for this bot:\n`);
    
    let notetakerInvoked = false;
    
    artifacts.forEach((artifact, idx) => {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Artifact ${idx + 1}:`);
      console.log(`  ID: ${artifact.id}`);
      console.log(`  Event ID: ${artifact.recallEventId || 'N/A'}`);
      console.log(`  Bot ID: ${artifact.recallBotId}`);
      console.log(`  Event Type: ${artifact.eventType || 'N/A'}`);
      console.log(`  Status: ${artifact.status}`);
      console.log(`  Created: ${artifact.createdAt}`);
      
      // Check for transcript in payload (indicates notetaker was invoked)
      const payload = artifact.rawPayload || {};
      const data = payload.data || payload;
      
      const hasTranscript = !!(
        data?.transcript?.segments ||
        data?.transcript_segments ||
        data?.segments ||
        payload?.transcript?.segments ||
        payload?.transcript_segments
      );
      
      if (hasTranscript) {
        const segments = data?.transcript?.segments || 
                        data?.transcript_segments ||
                        data?.segments ||
                        payload?.transcript?.segments ||
                        payload?.transcript_segments || [];
        
        console.log(`  ✅ NOTETAKER INVOKED`);
        console.log(`     - Found ${segments.length} transcript segment(s)`);
        console.log(`     - This confirms the notetaker processed the meeting`);
        notetakerInvoked = true;
        
        // Show sample transcript
        if (segments.length > 0 && segments[0]?.text) {
          console.log(`     - Sample: "${segments[0].text.substring(0, 100)}..."`);
        }
      } else {
        console.log(`  ❌ Notetaker NOT invoked`);
        console.log(`     - No transcript segments found in payload`);
        console.log(`     - Payload keys: ${Object.keys(data || {}).join(', ')}`);
      }
      
      console.log('');
    });
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n📊 SUMMARY:`);
    if (notetakerInvoked) {
      console.log(`✅ YES - The notetaker WAS invoked for this bot`);
      console.log(`   Found transcript data in meeting artifacts`);
    } else {
      console.log(`❌ NO - The notetaker was NOT invoked (or data not received yet)`);
      console.log(`   No transcript segments found in any artifacts`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.sequelize.close();
  }
}

checkNotetaker();

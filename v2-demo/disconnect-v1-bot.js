import dotenv from "dotenv";
import { getClient } from "./services/recall/api-client.js";

dotenv.config();

// IDs from the user's meeting data
const BOT_ID = process.env.BOT_ID || "3f47b59f-7a30-487d-a879-834d0e64916c";
const CALENDAR_MEETING_ID = process.env.CALENDAR_MEETING_ID || "b75744ee-7c01-410f-b7e3-f12bc78fc9b1";

async function disconnectBot() {
  const client = getClient();
  
  console.log(`🚫 Disconnecting V1 scheduler bot`);
  console.log(`   Bot/Meeting ID: ${BOT_ID}`);
  console.log(`   Calendar Meeting ID: ${CALENDAR_MEETING_ID}`);
  console.log(`API Host: ${process.env.RECALL_API_HOST}`);
  console.log(`API Key: ${process.env.RECALL_API_KEY ? 'Set' : 'Not set'}`);
  console.log('');
  
  try {
    // First, try to get the bot status to see what state it's in
    console.log("📊 Checking bot status...");
    let botInfo;
    try {
      // Try V1 endpoint first
      botInfo = await client.request({
        path: `/api/v1/bots/${BOT_ID}/`,
        method: "GET",
      });
      console.log("✅ Bot info retrieved:");
      console.log(`   Status: ${botInfo.status_changes?.[botInfo.status_changes.length - 1]?.code || 'unknown'}`);
      console.log(`   Bot Name: ${botInfo.bot_name || 'N/A'}`);
      console.log(`   Join At: ${botInfo.join_at || 'N/A'}`);
    } catch (err) {
      console.log(`⚠️  Could not fetch bot info from V1: ${err.message}`);
      console.log("   Will attempt to disconnect anyway...");
    }
    
    console.log('\n🔄 Attempting to disconnect bot...');
    
    // Try multiple V1 API endpoint patterns to disconnect the bot
    const endpoints = [
      {
        path: `/api/v1/bots/${BOT_ID}/leave/`,
        method: "PATCH",
        description: "V1 leave endpoint"
      },
      {
        path: `/api/v1/bots/${BOT_ID}/`,
        method: "PATCH",
        data: { status: "left" },
        description: "V1 status update to 'left'"
      },
      {
        path: `/api/v1/bots/${BOT_ID}/`,
        method: "DELETE",
        description: "V1 DELETE endpoint"
      },
    ];
    
    let success = false;
    for (const endpoint of endpoints) {
      try {
        console.log(`\n   Trying: ${endpoint.method} ${endpoint.path} (${endpoint.description})`);
        const result = await client.request({
          path: endpoint.path,
          method: endpoint.method,
          data: endpoint.data,
        });
        
        console.log(`   ✅ Success! Bot disconnected via ${endpoint.description}`);
        if (result) {
          console.log(`   Response: ${JSON.stringify(result, null, 2)}`);
        }
        success = true;
        break;
      } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
        // If it's a 404, try next endpoint. If it's something else, show the error but continue.
        if (err.message.includes('404')) {
          console.log(`   (Endpoint not found, trying next...)`);
        } else if (err.message.includes('405')) {
          console.log(`   (Method not allowed, trying next...)`);
        } else {
          // For other errors, log but continue trying other endpoints
          console.log(`   (Will try other endpoints...)`);
        }
      }
    }
    
    if (!success) {
      console.log('\n⚠️  Bot endpoints not found. Trying V1 calendar meeting endpoint...');
      
      // Try V1 calendar meeting endpoint to disable recording
      try {
        console.log(`\n   Trying: PUT /api/v1/calendar/meetings/${CALENDAR_MEETING_ID}/ (Disable recording)`);
        const result = await client.request({
          path: `/api/v1/calendar/meetings/${CALENDAR_MEETING_ID}/`,
          method: "PUT",
          data: { override_should_record: false }
        });
        
        console.log(`   ✅ Success! Disabled recording via V1 calendar meeting endpoint`);
        if (result) {
          console.log(`   Response: ${JSON.stringify(result, null, 2)}`);
        }
        success = true;
      } catch (err) {
        console.log(`   ❌ Failed: ${err.message}`);
        console.log('\n   Trying V2 endpoints as fallback...');
        
        // Fallback to V2 endpoints if V1 doesn't work
        const v2Endpoints = [
          {
            path: `/api/v2/bots/${BOT_ID}/leave/`,
            method: "PATCH",
            description: "V2 leave endpoint"
          },
          {
            path: `/api/v2/bots/${BOT_ID}/`,
            method: "PATCH",
            data: { status: "left" },
            description: "V2 status update"
          },
        ];
        
        for (const endpoint of v2Endpoints) {
          try {
            console.log(`\n   Trying: ${endpoint.method} ${endpoint.path} (${endpoint.description})`);
            const result = await client.request({
              path: endpoint.path,
              method: endpoint.method,
              data: endpoint.data,
            });
            
            console.log(`   ✅ Success! Bot disconnected via ${endpoint.description}`);
            if (result) {
              console.log(`   Response: ${JSON.stringify(result, null, 2)}`);
            }
            success = true;
            break;
          } catch (err) {
            console.log(`   ❌ Failed: ${err.message}`);
          }
        }
      }
    }
    
    if (success) {
      console.log('\n✅ Bot disconnected successfully!');
      console.log('\n💡 Note: If the bot was scheduled via V1 calendar, it may rejoin.');
      console.log('   You may need to disconnect the V1 calendar connection to prevent it from overriding meeting requests.');
    } else {
      console.log('\n❌ Failed to disconnect bot using any known endpoint.');
      console.log('\n💡 Since V1 scheduler is overriding meeting requests, you may need to:');
      console.log('   1. Disconnect the V1 calendar connection entirely');
      console.log('   2. Or contact Recall.ai support for the correct V1 bot disconnect endpoint');
      console.log('\n   The bot ID endpoints returned 404, which suggests:');
      console.log('   - The bot may have already left/disconnected');
      console.log('   - The ID might be a meeting ID, not a bot ID');
      console.log('   - The V1 API structure may differ from expectations');
    }
    
    console.log('\n📋 Additional actions to prevent V1 scheduler from overriding:');
    console.log('   1. Check your V1 calendar connections at your Recall.ai dashboard');
    console.log('   2. Disconnect any V1 calendar integrations that are auto-scheduling bots');
    console.log('   3. Ensure your V2 calendar system is properly configured');
    
    // Verify the bot status after disconnection attempt
    if (success) {
      console.log('\n📊 Verifying bot status...');
      try {
        const updatedBotInfo = await client.request({
          path: `/api/v1/bots/${BOT_ID}/`,
          method: "GET",
        });
        const latestStatus = updatedBotInfo.status_changes?.[updatedBotInfo.status_changes.length - 1]?.code;
        console.log(`   Current status: ${latestStatus || 'unknown'}`);
        
        if (latestStatus === 'left_call' || latestStatus === 'call_ended') {
          console.log('   ✅ Bot has left the meeting');
        }
      } catch (err) {
        console.log(`   ⚠️  Could not verify status: ${err.message}`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

// Run the disconnect function
disconnectBot().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
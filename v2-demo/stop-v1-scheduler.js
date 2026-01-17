import dotenv from "dotenv";
import { getClient } from "./services/recall/api-client.js";

dotenv.config();

/**
 * This script helps stop V1 scheduler from automatically attending meetings.
 * 
 * The issue: V1 calendar scheduler is auto-scheduling bots that override your V2 bot requests.
 * 
 * Solutions:
 * 1. Disconnect V1 calendar connection via Recall.ai dashboard (recommended)
 * 2. Use this script to try finding and removing V1 scheduled bots
 * 3. Ensure V2 calendar is properly configured and V1 is disconnected
 */

async function stopV1Scheduler() {
  const client = getClient();
  
  console.log(`🛑 Stopping V1 Scheduler from Auto-Attending Meetings\n`);
  console.log(`API Host: ${process.env.RECALL_API_HOST}`);
  console.log(`API Key: ${process.env.RECALL_API_KEY ? 'Set' : 'Not set'}`);
  console.log('');
  
  try {
    console.log('📋 Understanding the Problem:');
    console.log('   • V1 calendar scheduler automatically schedules bots for all meetings');
    console.log('   • V1 bots override V2 bot requests');
    console.log('   • You need to disconnect V1 calendar connection to stop this');
    console.log('');
    
    console.log('🔍 Attempting to find V1 calendar connections...\n');
    
    // Try to find V1 calendar users (this may not work with API key auth)
    // V1 calendar API requires calendar auth tokens, not API keys
    console.log('⚠️  Note: V1 calendar API uses calendar auth tokens, not API keys.');
    console.log('   The following attempts may fail, but will help identify what\'s needed.\n');
    
    // Try common V1 endpoints to list users/calendars
    const v1Endpoints = [
      { path: '/api/v1/calendar/users/', method: 'GET', description: 'List V1 calendar users' },
      { path: '/api/v1/calendar/connections/', method: 'GET', description: 'List V1 calendar connections' },
      { path: '/api/v1/calendars/', method: 'GET', description: 'List V1 calendars' },
    ];
    
    let foundConnections = false;
    for (const endpoint of v1Endpoints) {
      try {
        console.log(`   Trying: ${endpoint.method} ${endpoint.path}`);
        const result = await client.request({
          path: endpoint.path,
          method: endpoint.method,
        });
        
        if (result && (Array.isArray(result) ? result.length > 0 : Object.keys(result).length > 0)) {
          console.log(`   ✅ Found data!`);
          console.log(`   Response: ${JSON.stringify(result, null, 2)}`);
          foundConnections = true;
        } else {
          console.log(`   ⚠️  Endpoint exists but returned empty`);
        }
      } catch (err) {
        if (err.message.includes('401') || err.message.includes('403')) {
          console.log(`   ⚠️  Requires V1 calendar auth token (not API key)`);
        } else if (err.message.includes('404')) {
          console.log(`   ❌ Endpoint not found`);
        } else {
          console.log(`   ❌ Error: ${err.message.split('\n')[0]}`);
        }
      }
    }
    
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('📝 SOLUTION: How to Stop V1 Scheduler\n');
    console.log('Method 1: Disconnect via Recall.ai Dashboard (RECOMMENDED)');
    console.log('   1. Go to https://recall.ai/dashboard (or your Recall.ai dashboard URL)');
    console.log('   2. Navigate to Calendar/Integrations settings');
    console.log('   3. Find any V1 calendar connections (Google Calendar, Microsoft Teams, etc.)');
    console.log('   4. Disconnect/Delete the V1 calendar connection');
    console.log('   5. This will stop V1 scheduler from auto-attending meetings\n');
    
    console.log('Method 2: Disconnect V1 Calendar via V1 API (Requires V1 Auth Token)');
    console.log('   If you have a V1 calendar auth token, you can call:');
    console.log('   DELETE /api/v1/calendar/user/');
    console.log('   Header: X-RecallCalendarAuthToken: <your-v1-token>');
    console.log('   Note: V1 calendar API uses different authentication than V2 API\n');
    
    console.log('Method 3: Disable Auto-Schedule in V1 Preferences');
    console.log('   If V1 connection still exists, you may be able to set preferences to:');
    console.log('   - record_internal: false');
    console.log('   - record_external: false');
    console.log('   - record_confirmed: false');
    console.log('   - record_non_host: false');
    console.log('   This prevents V1 from auto-scheduling bots\n');
    
    console.log('Method 4: Remove V1 Scheduled Bots from Upcoming Meetings');
    console.log('   If you have access to list V1 meetings, you can:');
    console.log('   - List upcoming meetings: GET /api/v1/calendar/meetings/');
    console.log('   - For each meeting, set override_should_record: false');
    console.log('   - This prevents bots from attending those specific meetings\n');
    
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('🔧 Next Steps After Disconnecting V1:\n');
    console.log('1. Verify V1 calendar is disconnected');
    console.log('2. Ensure V2 calendar is properly configured');
    console.log('3. Test by creating a new meeting - only V2 bot should attend');
    console.log('4. Monitor that V1 scheduler no longer interferes\n');
    
    console.log('💡 Additional Notes:');
    console.log('   • V1 and V2 can coexist, but V1 scheduler will override V2 if both are active');
    console.log('   • Once V1 is disconnected, all new meetings will only use V2 scheduler');
    console.log('   • Existing scheduled meetings from V1 may still have bots until those meetings pass');
    console.log('   • You may need to manually remove bots from upcoming V1-scheduled meetings\n');
    
    if (!foundConnections) {
      console.log('⚠️  Could not find V1 connections via API (requires V1 calendar auth token).');
      console.log('   Use Method 1 (Dashboard) or obtain V1 calendar auth token for Method 2.\n');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
  }
}

// Run the function
stopV1Scheduler().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
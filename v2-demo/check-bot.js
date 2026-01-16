import dotenv from "dotenv";
import { getClient } from "./services/recall/api-client.js";

dotenv.config();

const botId = "5f66e9ce-c2dd-4fc7-a667-09af82ca664d";

async function checkBot() {
  const client = getClient();
  
  console.log(`Checking bot: ${botId}`);
  console.log(`API Host: ${process.env.RECALL_API_HOST}`);
  console.log(`API Key: ${process.env.RECALL_API_KEY ? 'Set' : 'Not set'}`);
  console.log('');
  
  try {
    // Try to get bot information - common endpoints
    const endpoints = [
      `/api/v2/bots/${botId}/`,
      `/api/v1/bots/${botId}/`,
      `/api/v2/bots/${botId}`,
      `/api/v1/bots/${botId}`,
    ];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`Trying: ${endpoint}`);
        const result = await client.request({
          path: endpoint,
          method: "GET",
        });
        console.log('✅ Success! Bot data:');
        console.log(JSON.stringify(result, null, 2));
        return;
      } catch (err) {
        console.log(`❌ ${endpoint}: ${err.message}`);
      }
    }
    
    console.log('\n⚠️  Could not find bot endpoint. Checking meeting artifacts in database...');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkBot().catch(console.error);

import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { connect as connectDb } from "./db.js";
import notionPublisher from "./publishing/publishers/notion.js";

async function testNotionPublish() {
  await connectDb();
  
  console.log("🧪 Testing Notion Publishing API\n");
  
  // Find a user with Notion integration
  const user = await db.User.findOne({
    where: { email: process.env.TEST_EMAIL || 'gene@tin.info' },
  });
  
  if (!user) {
    console.error("❌ User not found");
    process.exit(1);
  }
  
  console.log(`✅ Found user: ${user.email}\n`);
  
  // Check for Notion integration
  const integration = await db.Integration.findOne({
    where: { userId: user.id, provider: 'notion' },
  });
  
  if (!integration) {
    console.error("❌ Notion integration not found");
    console.log("   Please connect Notion in Settings first");
    process.exit(1);
  }
  
  console.log(`✅ Found Notion integration (ID: ${integration.id})\n`);
  
  // Check for Notion target
  const target = await db.PublishTarget.findOne({
    where: { userId: user.id, type: 'notion', enabled: true },
  });
  
  if (!target) {
    console.error("❌ Notion publish target not configured");
    console.log("   Please configure a Notion destination in Settings first");
    process.exit(1);
  }
  
  console.log(`✅ Found Notion target (ID: ${target.id})`);
  console.log(`   Config:`, JSON.stringify(target.config, null, 2));
  console.log();
  
  // Find a meeting summary to test with
  const summary = await db.MeetingSummary.findOne({
    where: { userId: user.id },
    order: [['createdAt', 'DESC']],
    include: [{ model: db.MeetingArtifact }],
  });
  
  if (!summary) {
    console.error("❌ No meeting summary found");
    console.log("   Please create a meeting summary first");
    process.exit(1);
  }
  
  console.log(`✅ Found meeting summary (ID: ${summary.id})`);
  console.log(`   Summary: ${summary.summary?.substring(0, 100)}...`);
  console.log(`   Action Items: ${summary.actionItems?.length || 0}`);
  console.log(`   Follow Ups: ${summary.followUps?.length || 0}`);
  console.log(`   Topics: ${summary.topics?.length || 0}`);
  console.log();
  
  // Test the publisher
  console.log("🚀 Testing Notion publisher...\n");
  
  try {
    const result = await notionPublisher({
      meetingSummary: summary,
      target,
      integration,
    });
    
    console.log("✅ SUCCESS!");
    console.log("   Result:", JSON.stringify(result, null, 2));
    console.log(`   URL: ${result.url}`);
    console.log(`   External ID: ${result.externalId}`);
  } catch (error) {
    console.error("❌ FAILED!");
    console.error("   Error:", error.message);
    console.error("   Stack:", error.stack);
    
    if (error.response) {
      console.error("   Response status:", error.response.status);
      console.error("   Response body:", await error.response.text().catch(() => 'N/A'));
    }
    
    process.exit(1);
  }
  
  process.exit(0);
}

testNotionPublish().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});



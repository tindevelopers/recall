import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { connect } from "./db.js";

async function checkEnrichment() {
  try {
    await connect();
    console.log("✅ Database connected");

    // Access models directly from db (they're initialized by connect())
    // Get all artifacts with their summaries
    const artifacts = await db.MeetingArtifact.findAll({
      include: [{ model: db.MeetingSummary }],
      order: [["createdAt", "DESC"]],
      limit: 10,
    });

    console.log(`\n📊 Found ${artifacts.length} artifacts\n`);

    let withSummary = 0;
    let withoutSummary = 0;

    for (const artifact of artifacts) {
      const summary = artifact.MeetingSummaries?.[0];
      const hasSummary = !!summary;

      if (hasSummary) {
        withSummary++;
        console.log(`✅ Artifact ${artifact.id.substring(0, 8)}...`);
        console.log(`   Summary: ${summary.summary ? "Yes" : "No"} (${summary.summary?.length || 0} chars)`);
        console.log(`   Action Items: ${summary.actionItems?.length || 0}`);
        console.log(`   Follow-ups: ${summary.followUps?.length || 0}`);
        console.log(`   Topics: ${summary.topics?.length || 0}`);
        console.log(`   Source: ${summary.source || "unknown"}`);
      } else {
        withoutSummary++;
        console.log(`❌ Artifact ${artifact.id.substring(0, 8)}... - NO SUMMARY`);
        console.log(`   Status: ${artifact.status}`);
      }
      console.log("");
    }

    console.log(`\n📈 Summary:`);
    console.log(`   With summaries: ${withSummary}`);
    console.log(`   Without summaries: ${withoutSummary}`);

    // Check if worker is needed
    if (withoutSummary > 0) {
      console.log(`\n⚠️  ${withoutSummary} artifacts need enrichment. Make sure the worker is running!`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

checkEnrichment();

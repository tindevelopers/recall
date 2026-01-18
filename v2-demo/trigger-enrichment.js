import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { connect } from "./db.js";
import { backgroundQueue } from "./queue.js";

async function triggerEnrichment() {
  try {
    await connect();
    console.log("✅ Database connected");

    // Find artifacts without summaries
    const artifacts = await db.MeetingArtifact.findAll({
      include: [{ 
        model: db.MeetingSummary,
        required: false 
      }],
      where: {
        status: 'done'
      },
      order: [["createdAt", "DESC"]],
      limit: 20,
    });

    const artifactsWithoutSummary = artifacts.filter(a => !a.MeetingSummaries || a.MeetingSummaries.length === 0);

    console.log(`\n📊 Found ${artifacts.length} artifacts`);
    console.log(`   ${artifactsWithoutSummary.length} need enrichment\n`);

    if (artifactsWithoutSummary.length === 0) {
      console.log("✅ All artifacts already have summaries!");
      process.exit(0);
    }

    console.log("🚀 Triggering enrichment jobs...\n");

    for (const artifact of artifactsWithoutSummary) {
      try {
        await backgroundQueue.add("meeting.enrich", {
          meetingArtifactId: artifact.id,
        });
        console.log(`✅ Queued enrichment for artifact ${artifact.id.substring(0, 8)}...`);
      } catch (error) {
        console.error(`❌ Failed to queue artifact ${artifact.id.substring(0, 8)}...:`, error.message);
      }
    }

    console.log(`\n✅ Queued ${artifactsWithoutSummary.length} enrichment jobs`);
    console.log("   Check the worker logs to see processing status");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

triggerEnrichment();

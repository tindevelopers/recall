import dotenv from "dotenv";
dotenv.config();

import db from "./recall/db.js";

async function checkNotionPublishing() {
  try {
    await db.connect();
    
    // Find all failed Notion publishing attempts
    const failedDeliveries = await db.PublishDelivery.findAll({
      where: {
        status: "failed",
      },
      include: [
        {
          model: db.PublishTarget,
          where: {
            type: "notion",
          },
          required: true,
        },
        {
          model: db.MeetingSummary,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: 10,
    });

    console.log(`\n📊 Found ${failedDeliveries.length} failed Notion publishing attempts:\n`);

    for (const delivery of failedDeliveries) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Delivery ID: ${delivery.id}`);
      console.log(`Meeting Summary ID: ${delivery.meetingSummaryId}`);
      console.log(`Status: ${delivery.status}`);
      console.log(`Attempts: ${delivery.attempts}`);
      console.log(`Last Error: ${delivery.lastError || "N/A"}`);
      console.log(`Created: ${delivery.createdAt}`);
      console.log(`Updated: ${delivery.updatedAt}`);
      if (delivery.PublishTarget) {
        console.log(`Target Config:`, JSON.stringify(delivery.PublishTarget.config, null, 2));
      }
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }

    // Also check pending deliveries
    const pendingDeliveries = await db.PublishDelivery.findAll({
      where: {
        status: "pending",
      },
      include: [
        {
          model: db.PublishTarget,
          where: {
            type: "notion",
          },
          required: true,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: 5,
    });

    if (pendingDeliveries.length > 0) {
      console.log(`\n⏳ Found ${pendingDeliveries.length} pending Notion publishing attempts\n`);
    }

    // Check for Notion integrations
    const notionIntegrations = await db.Integration.findAll({
      where: {
        provider: "notion",
      },
    });

    console.log(`\n🔗 Found ${notionIntegrations.length} Notion integration(s)`);
    for (const integration of notionIntegrations) {
      console.log(`  - User ID: ${integration.userId}`);
      console.log(`  - Has Access Token: ${!!integration.accessToken}`);
      console.log(`  - Created: ${integration.createdAt}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error checking Notion publishing:", error);
    process.exit(1);
  }
}

checkNotionPublishing();


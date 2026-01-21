import dotenv from "dotenv";
dotenv.config();

import { migrate } from "./db.js";

async function runMigrations() {
  try {
    console.log("🔄 Running database migrations...");
    await migrate();
    console.log("✅ Migrations complete");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

runMigrations();


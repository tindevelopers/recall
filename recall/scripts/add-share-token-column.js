import { Sequelize } from "sequelize";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, "../.env") });

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false,
  dialect: "postgres",
});

(async () => {
  try {
    console.log("Running migration: Add shareToken column to meeting_shares...");
    
    await sequelize.query(`
      ALTER TABLE meeting_shares 
      ADD COLUMN IF NOT EXISTS "shareToken" VARCHAR(64) UNIQUE;
      
      CREATE INDEX IF NOT EXISTS idx_meeting_shares_token ON meeting_shares("shareToken") 
      WHERE "shareToken" IS NOT NULL;
    `);
    
    console.log("✅ Migration completed successfully");
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    console.error(err);
    await sequelize.close();
    process.exit(1);
  }
})();


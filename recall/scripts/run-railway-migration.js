import { Sequelize } from "sequelize";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get DATABASE_URL from Railway
let databaseUrl;
try {
  const output = execSync("railway variables get DATABASE_URL", { encoding: "utf-8" });
  // Parse the output - Railway CLI format
  const match = output.match(/DATABASE_URL\s+\|\s+(.+)/);
  if (match) {
    databaseUrl = match[1].trim();
  }
} catch (err) {
  console.error("Failed to get DATABASE_URL from Railway:", err.message);
  process.exit(1);
}

if (!databaseUrl) {
  console.error("DATABASE_URL not found");
  process.exit(1);
}

console.log("Connecting to Railway PostgreSQL...");
const sequelize = new Sequelize(databaseUrl, {
  logging: false,
  dialect: "postgres",
  dialectOptions: {
    ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false,
  },
});

(async () => {
  try {
    // Read the migration file
    const migrationPath = join(__dirname, "../../supabase/migrations/20260123020000_add_share_token.sql");
    const migrationSQL = readFileSync(migrationPath, "utf-8");
    
    console.log("Running migration: Add shareToken column to meeting_shares...");
    console.log("Migration SQL:");
    console.log(migrationSQL);
    console.log("\n");
    
    // Execute the migration
    await sequelize.query(migrationSQL);
    
    console.log("✅ Migration completed successfully on Railway PostgreSQL");
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    if (err.original) {
      console.error("Original error:", err.original.message);
    }
    await sequelize.close();
    process.exit(1);
  }
})();


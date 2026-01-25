/**
 * Script to enable pgvector extension on Railway PostgreSQL
 * 
 * This script will:
 * 1. Check if pgvector is available
 * 2. Attempt to enable it
 * 3. Re-run migrations if successful
 * 
 * Usage:
 *   node scripts/enable-pgvector.js
 */

import { connect } from "../db.js";
import db from "../db.js";

async function enablePgVector() {
  console.log("🔍 Checking PostgreSQL connection...");
  await connect();
  console.log("✅ Connected to database");

  // Check PostgreSQL version
  const [versionResult] = await db.sequelize.query(
    "SELECT version();"
  );
  console.log("\n📊 PostgreSQL version:");
  console.log(versionResult[0].version);

  // Check if pgvector is available in the system
  console.log("\n🔍 Checking if pgvector is available...");
  const [availableExtensions] = await db.sequelize.query(
    "SELECT * FROM pg_available_extensions WHERE name = 'vector';"
  );

  if (availableExtensions.length === 0) {
    console.log("\n❌ pgvector extension is NOT available on this PostgreSQL instance");
    console.log("\n📝 To enable pgvector, you need to:");
    console.log("   1. Use Railway's 'PostgreSQL with pgvector' template");
    console.log("   2. Or install pgvector at the system level (requires admin access)");
    console.log("\n💡 Your application will continue to work with the JavaScript fallback");
    console.log("   for vector similarity search (slower but functional)");
    process.exit(0);
  }

  console.log("✅ pgvector extension is available!");
  console.log("   Version:", availableExtensions[0].default_version);

  // Check if pgvector is already enabled
  console.log("\n🔍 Checking if pgvector is enabled...");
  const [enabledExtensions] = await db.sequelize.query(
    "SELECT * FROM pg_extension WHERE extname = 'vector';"
  );

  if (enabledExtensions.length > 0) {
    console.log("✅ pgvector extension is already enabled!");
    console.log("   Version:", enabledExtensions[0].extversion);
  } else {
    console.log("⚠️  pgvector is available but not enabled. Attempting to enable...");
    
    try {
      await db.sequelize.query("CREATE EXTENSION IF NOT EXISTS vector;");
      console.log("✅ Successfully enabled pgvector extension!");
    } catch (error) {
      console.error("❌ Failed to enable pgvector:", error.message);
      console.log("\n💡 You may need database superuser privileges to enable extensions");
      process.exit(1);
    }
  }

  // Check if embeddings are using vector type
  console.log("\n🔍 Checking embedding column type...");
  const [columnInfo] = await db.sequelize.query(`
    SELECT data_type, udt_name
    FROM information_schema.columns 
    WHERE table_name = 'meeting_transcript_chunks' 
    AND column_name = 'embedding';
  `);

  if (columnInfo.length > 0) {
    console.log("   Current type:", columnInfo[0].data_type);
    if (columnInfo[0].data_type === 'USER-DEFINED' && columnInfo[0].udt_name === 'vector') {
      console.log("✅ Embeddings are already using vector type!");
    } else {
      console.log("⚠️  Embeddings are using JSON type");
      console.log("\n💡 To convert to vector type, run migrations:");
      console.log("   The migration '20260124090500-migrate-embeddings-to-vector.js'");
      console.log("   will automatically convert embeddings when pgvector is available");
    }
  }

  // Test vector operations
  console.log("\n🧪 Testing vector operations...");
  try {
    await db.sequelize.query("SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector AS distance;");
    console.log("✅ Vector operations are working!");
  } catch (error) {
    console.error("❌ Vector operations failed:", error.message);
  }

  console.log("\n✅ pgvector check complete!");
  console.log("\n📋 Next steps:");
  console.log("   1. If embeddings are JSON type, re-run migrations to convert them");
  console.log("   2. The application will automatically use fast pgvector queries");
  console.log("   3. Monitor logs for 'Using PostgreSQL pgvector' confirmation");
}

enablePgVector()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  });


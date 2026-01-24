/**
 * Enable pgvector extension for PostgreSQL
 */
export async function up({ context: { queryInterface } }) {
  // Enable pgvector extension (safe if already enabled)
  await queryInterface.sequelize.query(
    "CREATE EXTENSION IF NOT EXISTS vector;"
  );
}

export async function down({ context: { queryInterface } }) {
  // Drop extension (may fail if dependent objects exist)
  await queryInterface.sequelize.query(
    "DROP EXTENSION IF EXISTS vector;"
  );
}


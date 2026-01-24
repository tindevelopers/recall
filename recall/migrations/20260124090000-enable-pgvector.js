/**
 * Enable pgvector extension for PostgreSQL
 * 
 * Note: This migration will gracefully skip if pgvector is not available
 * in the PostgreSQL installation. Vector search features will be disabled
 * but the application will continue to function.
 */
export async function up({ context: { queryInterface } }) {
  try {
    // Enable pgvector extension (safe if already enabled)
    await queryInterface.sequelize.query(
      "CREATE EXTENSION IF NOT EXISTS vector;"
    );
    console.log('✅ pgvector extension enabled successfully');
  } catch (error) {
    // Log warning but don't fail the migration
    // This allows the app to deploy even if pgvector is not available
    console.warn('⚠️  pgvector extension not available - vector search features will be disabled');
    console.warn('   To enable vector search, install pgvector in your PostgreSQL database');
    console.warn('   Error:', error.message);
    
    // Don't throw - allow migration to succeed
    // The subsequent migrations that depend on pgvector will also need to handle this gracefully
  }
}

export async function down({ context: { queryInterface } }) {
  try {
    // Drop extension (may fail if dependent objects exist or if extension was never created)
    await queryInterface.sequelize.query(
      "DROP EXTENSION IF EXISTS vector;"
    );
  } catch (error) {
    // Ignore errors on down migration
    console.warn('Could not drop pgvector extension:', error.message);
  }
}


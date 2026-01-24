/**
 * Migrate embeddings from JSON to vector type
 * 
 * Note: This migration will skip if pgvector is not available.
 * Embeddings will remain as JSON in that case.
 */
export async function up({ context: { queryInterface } }) {
  try {
    // Check if pgvector extension is available
    const [results] = await queryInterface.sequelize.query(
      "SELECT 1 FROM pg_available_extensions WHERE name = 'vector';"
    );
    
    if (results.length === 0) {
      console.warn('⚠️  Skipping embedding migration - pgvector extension not available');
      console.warn('   Embeddings will remain as JSON type');
      return;
    }

    // Ensure pgvector extension is enabled
    await queryInterface.sequelize.query(
      "CREATE EXTENSION IF NOT EXISTS vector;"
    );

    // Convert JSON embeddings to vector type (assumes 1536-dim OpenAI embeddings)
    await queryInterface.sequelize.query(`
      ALTER TABLE meeting_transcript_chunks
      ALTER COLUMN embedding DROP DEFAULT,
      ALTER COLUMN embedding TYPE vector(1536)
      USING (
        CASE
          WHEN embedding IS NULL THEN NULL
          WHEN json_typeof(embedding) = 'array' THEN (embedding::jsonb::text)::vector
          ELSE NULL
        END
      );
    `);
    
    console.log('✅ Successfully migrated embeddings to vector type');
  } catch (error) {
    console.warn('⚠️  Could not migrate embeddings to vector type:', error.message);
    console.warn('   Embeddings will remain as JSON type');
    // Don't throw - allow migration to succeed
  }
}

export async function down({ context: { queryInterface } }) {
  try {
    // Check if column is vector type before reverting
    const [results] = await queryInterface.sequelize.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'meeting_transcript_chunks' 
      AND column_name = 'embedding';
    `);
    
    if (results.length > 0 && results[0].data_type === 'USER-DEFINED') {
      // Revert embedding column back to JSON
      await queryInterface.sequelize.query(`
        ALTER TABLE meeting_transcript_chunks
        ALTER COLUMN embedding TYPE json
        USING (
          CASE
            WHEN embedding IS NULL THEN NULL
            ELSE to_jsonb(embedding)
          END
        );
      `);
    }
  } catch (error) {
    console.warn('Could not revert embedding column:', error.message);
  }
}


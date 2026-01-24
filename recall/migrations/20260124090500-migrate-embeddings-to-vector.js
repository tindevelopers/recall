/**
 * Migrate embeddings from JSON to vector type
 */
export async function up({ context: { queryInterface } }) {
  // Ensure pgvector extension is available
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
}

export async function down({ context: { queryInterface } }) {
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


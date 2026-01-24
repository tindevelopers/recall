/**
 * Create vector index for faster similarity search
 */
export async function up({ context: { queryInterface } }) {
  // Ensure pgvector extension exists
  await queryInterface.sequelize.query(
    "CREATE EXTENSION IF NOT EXISTS vector;"
  );

  // Create IVFFlat index for faster vector similarity search
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS meeting_transcript_chunks_embedding_ivfflat
    ON meeting_transcript_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
  `);
}

export async function down({ context: { queryInterface } }) {
  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS meeting_transcript_chunks_embedding_ivfflat;
  `);
}


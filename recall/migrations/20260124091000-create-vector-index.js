/**
 * Create vector index for faster similarity search
 * 
 * Note: This migration will skip if pgvector is not available.
 */
export async function up({ context: { queryInterface } }) {
  try {
    // Check if pgvector extension is available and enabled
    const [results] = await queryInterface.sequelize.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'vector';"
    );
    
    if (results.length === 0) {
      console.warn('⚠️  Skipping vector index creation - pgvector extension not enabled');
      return;
    }

    // Check if embedding column is vector type
    const [columnInfo] = await queryInterface.sequelize.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'meeting_transcript_chunks' 
      AND column_name = 'embedding';
    `);
    
    if (columnInfo.length === 0 || columnInfo[0].data_type !== 'USER-DEFINED') {
      console.warn('⚠️  Skipping vector index creation - embedding column is not vector type');
      return;
    }

    // Create IVFFlat index for faster vector similarity search
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS meeting_transcript_chunks_embedding_ivfflat
      ON meeting_transcript_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
    
    console.log('✅ Successfully created vector index');
  } catch (error) {
    console.warn('⚠️  Could not create vector index:', error.message);
    // Don't throw - allow migration to succeed
  }
}

export async function down({ context: { queryInterface } }) {
  try {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS meeting_transcript_chunks_embedding_ivfflat;
    `);
  } catch (error) {
    console.warn('Could not drop vector index:', error.message);
  }
}


("use strict");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
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
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS meeting_transcript_chunks_embedding_ivfflat;
    `);
  },
};


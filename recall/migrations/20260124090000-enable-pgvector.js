("use strict");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Enable pgvector extension (safe if already enabled)
    await queryInterface.sequelize.query(
      "CREATE EXTENSION IF NOT EXISTS vector;"
    );
  },

  async down(queryInterface, Sequelize) {
    // Drop extension (may fail if dependent objects exist)
    await queryInterface.sequelize.query(
      "DROP EXTENSION IF EXISTS vector;"
    );
  },
};


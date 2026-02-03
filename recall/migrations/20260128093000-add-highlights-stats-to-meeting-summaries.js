"use strict";

/** Add highlights, detailedNotes, and stats (JSONB) to meeting_summaries. Uses raw SQL to avoid Sequelize/DataTypes context issues in Umzug. */
export async function up({ context: { queryInterface } }) {
  const { sequelize } = queryInterface;
  await sequelize.query('ALTER TABLE "meeting_summaries" ADD COLUMN IF NOT EXISTS "highlights" JSONB NULL;');
  await sequelize.query('ALTER TABLE "meeting_summaries" ADD COLUMN IF NOT EXISTS "detailedNotes" JSONB NULL;');
  await sequelize.query('ALTER TABLE "meeting_summaries" ADD COLUMN IF NOT EXISTS "stats" JSONB NULL;');
}

export async function down({ context: { queryInterface } }) {
  await queryInterface.removeColumn("meeting_summaries", "stats");
  await queryInterface.removeColumn("meeting_summaries", "detailedNotes");
  await queryInterface.removeColumn("meeting_summaries", "highlights");
}

export async function up({ context: queryInterface, Sequelize }) {
  await queryInterface.addColumn("meeting_summaries", "highlights", {
    type: Sequelize.JSONB,
    allowNull: true,
  });

  await queryInterface.addColumn("meeting_summaries", "detailedNotes", {
    type: Sequelize.JSONB,
    allowNull: true,
  });

  await queryInterface.addColumn("meeting_summaries", "stats", {
    type: Sequelize.JSONB,
    allowNull: true,
  });
}

export async function down({ context: queryInterface }) {
  await queryInterface.removeColumn("meeting_summaries", "stats");
  await queryInterface.removeColumn("meeting_summaries", "detailedNotes");
  await queryInterface.removeColumn("meeting_summaries", "highlights");
}

/**
 * Add meeting metadata columns to meeting_artifacts.
 */
export async function up({ context: { queryInterface } }) {
  const sequelize = queryInterface.sequelize;
  await sequelize.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'meeting_platform_enum'
      ) THEN
        CREATE TYPE meeting_platform_enum AS ENUM ('teams', 'zoom', 'webex', 'google_meet');
      END IF;
    END$$;
  `);

  await queryInterface.addColumn("meeting_artifacts", "meetingPlatform", {
    type: "meeting_platform_enum",
    allowNull: true,
  });
  await queryInterface.addColumn("meeting_artifacts", "meetingId", {
    type: queryInterface.sequelize.Sequelize.STRING,
    allowNull: true,
  });
  await queryInterface.addColumn("meeting_artifacts", "displayMeetingId", {
    type: queryInterface.sequelize.Sequelize.STRING,
    allowNull: true,
  });
  await queryInterface.addColumn("meeting_artifacts", "meetingUrl", {
    type: queryInterface.sequelize.Sequelize.TEXT,
    allowNull: true,
  });
}

export async function down({ context: { queryInterface } }) {
  await queryInterface.removeColumn("meeting_artifacts", "meetingPlatform");
  await queryInterface.removeColumn("meeting_artifacts", "meetingId");
  await queryInterface.removeColumn("meeting_artifacts", "displayMeetingId");
  await queryInterface.removeColumn("meeting_artifacts", "meetingUrl");
  await queryInterface.sequelize.query(
    "DROP TYPE IF EXISTS meeting_platform_enum;"
  );
}


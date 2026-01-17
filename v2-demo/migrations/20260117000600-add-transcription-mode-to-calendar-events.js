import Sequelize from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  // Add transcriptionMode to calendar_events for per-meeting override
  await queryInterface.addColumn("calendar_events", "transcriptionMode", {
    type: Sequelize.STRING,
    allowNull: true,
    defaultValue: null,
    comment: "Per-event transcription mode override: 'realtime', 'async', or null (use calendar default)",
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeColumn("calendar_events", "transcriptionMode");
};

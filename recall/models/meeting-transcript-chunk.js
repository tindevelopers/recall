import { DataTypes } from "sequelize";

export default (sequelize) => {
  return sequelize.define(
    "MeetingTranscriptChunk",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      meetingArtifactId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      calendarEventId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      sequence: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      startTimeMs: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      endTimeMs: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      speaker: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      embedding: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: "meeting_transcript_chunks",
      modelName: "MeetingTranscriptChunk",
    }
  );
};



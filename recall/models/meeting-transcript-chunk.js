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
        // Stored as pgvector (vector(1536)) in the database
        // Sequelize doesn't have native vector type; use raw definition
        type: "VECTOR(1536)",
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



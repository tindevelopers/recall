import { DataTypes } from "sequelize";

export default (sequelize) => {
  return sequelize.define(
    "MeetingArtifact",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      recallEventId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      recallBotId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      calendarEventId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "User who created/triggered the recording",
      },
      ownerUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: "Primary owner of the meeting (usually the organizer)",
      },
      eventType: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "received",
      },
      rawPayload: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      readableId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      meetingPlatform: {
        type: DataTypes.ENUM("teams", "zoom", "webex", "google_meet"),
        allowNull: true,
      },
      meetingId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      displayMeetingId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      meetingUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Recording metadata
      sourceRecordingUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Original recording URL from the source platform",
      },
      sourceRecordingExpiry: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Expiration timestamp for the source recording URL if signed",
      },
      archivedRecordingUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Archived recording URL in user-configured storage (S3-compatible)",
      },
      archivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Timestamp when recording was archived to user storage",
      },
      recordingFormat: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Recording mime/format e.g. video/mp4, audio/webm",
      },
      recordingDuration: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "Duration in seconds",
      },
      recordingSize: {
        type: DataTypes.BIGINT,
        allowNull: true,
        comment: "Size in bytes",
      },
    },
    {
      sequelize,
      tableName: "meeting_artifacts",
      modelName: "MeetingArtifact",
    }
  );
};



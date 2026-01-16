import { DataTypes } from "sequelize";

export default (sequelize) => {
  return sequelize.define(
    "MeetingSummary",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      meetingArtifactId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      calendarEventId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "completed",
      },
      summary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      actionItems: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      followUps: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      topics: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      source: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Source of the summary: recall_webhook, recall_notepad_api, recall_event_api, openai, etc.",
      },
    },
    {
      sequelize,
      tableName: "meeting_summaries",
      modelName: "MeetingSummary",
    }
  );
};



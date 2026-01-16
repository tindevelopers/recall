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
    },
    {
      sequelize,
      tableName: "meeting_summaries",
      modelName: "MeetingSummary",
    }
  );
};



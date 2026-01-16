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
    },
    {
      sequelize,
      tableName: "meeting_artifacts",
      modelName: "MeetingArtifact",
    }
  );
};



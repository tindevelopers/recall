import { DataTypes } from "sequelize";

export default (sequelize) => {
  return sequelize.define(
    "ActionItem",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      meetingSummaryId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      assignee: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("pending", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      completedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
        sequelize,
        tableName: "action_items",
        modelName: "ActionItem",
    }
  );
};


import { DataTypes } from "sequelize";

export default (sequelize) => {
  return sequelize.define(
    "PublishDelivery",
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
      publishTargetId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending",
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastError: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      externalId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      url: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: "publish_deliveries",
      modelName: "PublishDelivery",
    }
  );
};



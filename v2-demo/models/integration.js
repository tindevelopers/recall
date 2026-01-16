import { DataTypes } from "sequelize";

export default (sequelize) => {
  return sequelize.define(
    "Integration",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      accessToken: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      refreshToken: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      config: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: "integrations",
      modelName: "Integration",
    }
  );
};



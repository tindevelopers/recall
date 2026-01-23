import { DataTypes } from "sequelize";

export default (sequelize) => {
  return sequelize.define(
    "MeetingShare",
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
        references: {
          model: "meeting_artifacts",
          key: "id",
        },
      },
      sharedWithUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        comment: "User ID if shared with a registered user",
      },
      sharedWithEmail: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Email address if shared with someone not yet registered",
      },
      sharedByUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        comment: "The user who shared the meeting (must be owner)",
      },
      accessLevel: {
        type: DataTypes.ENUM("view", "edit", "admin"),
        allowNull: false,
        defaultValue: "view",
        comment: "view = read-only, edit = can add notes, admin = can reshare",
      },
      status: {
        type: DataTypes.ENUM("pending", "accepted", "declined", "revoked"),
        allowNull: false,
        defaultValue: "pending",
        comment: "pending = awaiting acceptance, accepted = active share",
      },
      acceptedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Optional expiration date for the share",
      },
      notifyOnUpdates: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether to notify this user when meeting is updated",
      },
    },
    {
      sequelize,
      tableName: "meeting_shares",
      modelName: "MeetingShare",
      indexes: [
        {
          unique: true,
          fields: ["meetingArtifactId", "sharedWithUserId"],
          where: {
            sharedWithUserId: { [DataTypes.Op || sequelize.Sequelize.Op]: { ne: null } },
          },
          name: "unique_meeting_user_share",
        },
        {
          unique: true,
          fields: ["meetingArtifactId", "sharedWithEmail"],
          where: {
            sharedWithEmail: { [DataTypes.Op || sequelize.Sequelize.Op]: { ne: null } },
          },
          name: "unique_meeting_email_share",
        },
        {
          fields: ["sharedWithUserId"],
        },
        {
          fields: ["sharedWithEmail"],
        },
        {
          fields: ["status"],
        },
      ],
    }
  );
};


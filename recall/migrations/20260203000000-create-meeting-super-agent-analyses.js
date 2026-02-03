"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  await queryInterface.createTable("meeting_super_agent_analyses", {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
    },
    meetingArtifactId: {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: "meeting_artifacts",
        key: "id",
      },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    userId: {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    status: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "queued",
    },
    requestedFeatures: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    assemblyTranscriptId: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    assemblyRequest: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    assemblyResult: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    detailedSummary: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    actionItems: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    decisions: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    highlights: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    chapters: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    sentiment: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    topics: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    contentSafety: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    piiRedactionApplied: {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    },
    translation: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    errorMessage: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    createdAt: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.dropTable("meeting_super_agent_analyses");
};

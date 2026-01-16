"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  // Meeting artifacts emitted by Recall notetaker (webhooks)
  await queryInterface.createTable("meeting_artifacts", {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
    },
    recallEventId: {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    },
    recallBotId: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    calendarEventId: {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: "calendar_events",
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
    eventType: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    status: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "received",
    },
    rawPayload: {
      type: Sequelize.JSON,
      allowNull: false,
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

  // Transcript chunks for RAG
  await queryInterface.createTable("meeting_transcript_chunks", {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
    },
    meetingArtifactId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: "meeting_artifacts",
        key: "id",
      },
      onDelete: "CASCADE",
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
    calendarEventId: {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: "calendar_events",
        key: "id",
      },
      onDelete: "SET NULL",
      onUpdate: "CASCADE",
    },
    sequence: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    startTimeMs: {
      type: Sequelize.FLOAT,
      allowNull: true,
    },
    endTimeMs: {
      type: Sequelize.FLOAT,
      allowNull: true,
    },
    speaker: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    text: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    embedding: {
      type: Sequelize.JSON,
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

  // Meeting summaries generated via LLM
  await queryInterface.createTable("meeting_summaries", {
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
    calendarEventId: {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: "calendar_events",
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
      defaultValue: "completed",
    },
    summary: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    actionItems: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    followUps: {
      type: Sequelize.JSON,
      allowNull: true,
    },
    topics: {
      type: Sequelize.JSON,
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

  // Per-user OAuth integrations (e.g., Notion)
  await queryInterface.createTable("integrations", {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
    },
    userId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    provider: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    accessToken: {
      type: Sequelize.TEXT,
      allowNull: false,
    },
    refreshToken: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    expiresAt: {
      type: Sequelize.DATE,
      allowNull: true,
    },
    config: {
      type: Sequelize.JSON,
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

  // Publishing targets (per user)
  await queryInterface.createTable("publish_targets", {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
    },
    userId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    type: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    enabled: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    config: {
      type: Sequelize.JSON,
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

  // Publishing deliveries (per note per target)
  await queryInterface.createTable("publish_deliveries", {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
    },
    meetingSummaryId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: "meeting_summaries",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    publishTargetId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: "publish_targets",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    status: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    attempts: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    lastError: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    externalId: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    url: {
      type: Sequelize.STRING,
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

  // Helpful indexes
  await queryInterface.addIndex("meeting_transcript_chunks", ["meetingArtifactId"]);
  await queryInterface.addIndex("meeting_transcript_chunks", ["userId"]);
  await queryInterface.addIndex("meeting_summaries", ["calendarEventId"]);
  await queryInterface.addIndex("meeting_summaries", ["userId"]);
  await queryInterface.addIndex("publish_targets", ["userId", "type"]);
  await queryInterface.addIndex("integrations", ["userId", "provider"], {
    unique: true,
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeIndex("integrations", ["userId", "provider"]);
  await queryInterface.removeIndex("publish_targets", ["userId", "type"]);
  await queryInterface.removeIndex("meeting_summaries", ["userId"]);
  await queryInterface.removeIndex("meeting_summaries", ["calendarEventId"]);
  await queryInterface.removeIndex("meeting_transcript_chunks", ["userId"]);
  await queryInterface.removeIndex("meeting_transcript_chunks", ["meetingArtifactId"]);

  await queryInterface.dropTable("publish_deliveries");
  await queryInterface.dropTable("publish_targets");
  await queryInterface.dropTable("integrations");
  await queryInterface.dropTable("meeting_summaries");
  await queryInterface.dropTable("meeting_transcript_chunks");
  await queryInterface.dropTable("meeting_artifacts");
};



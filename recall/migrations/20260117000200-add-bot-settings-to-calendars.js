"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  // Bot appearance settings
  await queryInterface.addColumn("calendars", "bot_name", {
    type: Sequelize.STRING,
    allowNull: true,
    defaultValue: "Meeting Assistant",
  });

  await queryInterface.addColumn("calendars", "bot_avatar_url", {
    type: Sequelize.STRING,
    allowNull: true,
  });

  // Recording settings
  await queryInterface.addColumn("calendars", "record_video", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });

  await queryInterface.addColumn("calendars", "record_audio", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });

  // Transcription settings
  await queryInterface.addColumn("calendars", "enable_transcription", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });

  await queryInterface.addColumn("calendars", "transcription_language", {
    type: Sequelize.STRING,
    allowNull: true,
    defaultValue: "en",
  });

  // AI enrichment settings
  await queryInterface.addColumn("calendars", "enable_summary", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });

  await queryInterface.addColumn("calendars", "enable_action_items", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });

  await queryInterface.addColumn("calendars", "enable_follow_ups", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });

  // Publishing settings
  await queryInterface.addColumn("calendars", "auto_publish_to_notion", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });

  // Bot behavior settings
  await queryInterface.addColumn("calendars", "join_before_start_minutes", {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 1,
  });

  await queryInterface.addColumn("calendars", "leave_after_end_minutes", {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });

  await queryInterface.addColumn("calendars", "auto_leave_if_alone", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });

  await queryInterface.addColumn("calendars", "auto_leave_alone_timeout_seconds", {
    type: Sequelize.INTEGER,
    allowNull: false,
    defaultValue: 60,
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeColumn("calendars", "bot_name");
  await queryInterface.removeColumn("calendars", "bot_avatar_url");
  await queryInterface.removeColumn("calendars", "record_video");
  await queryInterface.removeColumn("calendars", "record_audio");
  await queryInterface.removeColumn("calendars", "enable_transcription");
  await queryInterface.removeColumn("calendars", "transcription_language");
  await queryInterface.removeColumn("calendars", "enable_summary");
  await queryInterface.removeColumn("calendars", "enable_action_items");
  await queryInterface.removeColumn("calendars", "enable_follow_ups");
  await queryInterface.removeColumn("calendars", "auto_publish_to_notion");
  await queryInterface.removeColumn("calendars", "join_before_start_minutes");
  await queryInterface.removeColumn("calendars", "leave_after_end_minutes");
  await queryInterface.removeColumn("calendars", "auto_leave_if_alone");
  await queryInterface.removeColumn("calendars", "auto_leave_alone_timeout_seconds");
};

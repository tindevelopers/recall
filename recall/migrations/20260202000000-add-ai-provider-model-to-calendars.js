"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  // Add AI provider enum type
  await queryInterface.sequelize.query(`
    DO $$ BEGIN
      CREATE TYPE "enum_calendars_ai_provider" AS ENUM ('recall', 'openai', 'assemblyai', 'anthropic');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  // Add AI provider column
  await queryInterface.addColumn("calendars", "ai_provider", {
    type: Sequelize.ENUM("recall", "openai", "assemblyai", "anthropic"),
    allowNull: false,
    defaultValue: "recall",
    comment: "AI provider for summarization: recall, openai, assemblyai, anthropic",
  });

  // Add AI model column
  await queryInterface.addColumn("calendars", "ai_model", {
    type: Sequelize.STRING,
    allowNull: true,
    defaultValue: null,
    comment: "Specific model identifier (provider-specific, null = default)",
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeColumn("calendars", "ai_provider");
  await queryInterface.removeColumn("calendars", "ai_model");
  
  // Drop enum type
  await queryInterface.sequelize.query(`
    DROP TYPE IF EXISTS "enum_calendars_ai_provider";
  `);
};

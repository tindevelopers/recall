"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  // PostgreSQL: Create ENUM type first
  await queryInterface.sequelize.query(`
    DO $$ BEGIN
      CREATE TYPE "enum_calendars_transcription_mode" AS ENUM('realtime', 'async');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);
  
  // Add column with ENUM type
  await queryInterface.addColumn("calendars", "transcription_mode", {
    type: Sequelize.ENUM("realtime", "async"),
    allowNull: false,
    defaultValue: "realtime",
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeColumn("calendars", "transcription_mode");
  
  // Drop ENUM type
  await queryInterface.sequelize.query(`
    DROP TYPE IF EXISTS "enum_calendars_transcription_mode";
  `);
};

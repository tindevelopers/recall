"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  // Add transcription_mode column with ENUM type
  // Note: PostgreSQL and SQLite handle ENUMs differently
  // For PostgreSQL, we'll create the ENUM type first, then add the column
  // For SQLite, we'll use a CHECK constraint
  
  const dialect = queryInterface.sequelize.getDialect();
  
  if (dialect === "postgres") {
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
  } else {
    // SQLite: Use STRING with CHECK constraint
    await queryInterface.addColumn("calendars", "transcription_mode", {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "realtime",
    });
    
    // Add CHECK constraint for SQLite
    await queryInterface.addConstraint("calendars", {
      fields: ["transcription_mode"],
      type: "check",
      where: {
        transcription_mode: ["realtime", "async"],
      },
    });
  }
};

export const down = async ({ context: { queryInterface } }) => {
  const dialect = queryInterface.sequelize.getDialect();
  
  await queryInterface.removeColumn("calendars", "transcription_mode");
  
  if (dialect === "postgres") {
    // Drop ENUM type for PostgreSQL
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_calendars_transcription_mode";
    `);
  }
};

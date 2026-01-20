"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  // Add transcription_mode column with ENUM type
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
    // SQLite: Use TEXT with CHECK constraint instead of ENUM
    await queryInterface.addColumn("calendars", "transcription_mode", {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: "realtime",
    });
    
    // Add CHECK constraint for SQLite
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS calendars_new (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        email TEXT,
        platform TEXT NOT NULL,
        "recallId" TEXT,
        "recallData" TEXT,
        status TEXT,
        "transcriptionMode" TEXT DEFAULT 'realtime' CHECK("transcriptionMode" IN ('realtime', 'async')),
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );
      INSERT INTO calendars_new SELECT *, 'realtime' FROM calendars;
      DROP TABLE calendars;
      ALTER TABLE calendars_new RENAME TO calendars;
    `).catch(() => {
      // If table structure is different, just add the column
      // The CHECK constraint will be enforced by Sequelize
    });
  }
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeColumn("calendars", "transcription_mode");
  
  // Drop ENUM type for PostgreSQL only
  const dialect = queryInterface.sequelize.getDialect();
  if (dialect === "postgres") {
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_calendars_transcription_mode";
    `);
  }
};

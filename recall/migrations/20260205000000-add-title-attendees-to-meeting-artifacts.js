"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  const tableDescription = await queryInterface.describeTable("meeting_artifacts");
  
  // Add title column if it doesn't exist
  if (!tableDescription.title) {
    await queryInterface.addColumn("meeting_artifacts", "title", {
      type: Sequelize.STRING,
      allowNull: true,
      comment: "Meeting title for display (populated from calendar event or computed)",
    });
    console.log("[MIGRATION] Added title column to meeting_artifacts");
  }
  
  // Add attendeesJson column if it doesn't exist
  if (!tableDescription.attendeesJson) {
    await queryInterface.addColumn("meeting_artifacts", "attendeesJson", {
      type: Sequelize.JSON,
      allowNull: true,
      comment: "Cached attendees list [{name, email, organizer}] for quick display",
    });
    console.log("[MIGRATION] Added attendeesJson column to meeting_artifacts");
  }
  
  console.log("[MIGRATION] Completed adding title and attendeesJson columns");
};

export const down = async ({ context: { queryInterface } }) => {
  const tableDescription = await queryInterface.describeTable("meeting_artifacts");
  
  if (tableDescription.title) {
    await queryInterface.removeColumn("meeting_artifacts", "title");
  }
  
  if (tableDescription.attendeesJson) {
    await queryInterface.removeColumn("meeting_artifacts", "attendeesJson");
  }
};

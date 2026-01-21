"use strict";

import { Sequelize } from "sequelize";
import { generateReadableMeetingId } from "../utils/meeting-id.js";

export const up = async ({ context: { queryInterface } }) => {
  // Check if readableId column already exists
  const tableDescription = await queryInterface.describeTable("meeting_artifacts");
  const columnExists = tableDescription.readableId !== undefined;
  
  if (!columnExists) {
    // Add readableId column to meeting_artifacts
    await queryInterface.addColumn("meeting_artifacts", "readableId", {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    });
  }
  
  // Check if index exists before creating it
  const indexes = await queryInterface.showIndex("meeting_artifacts");
  const indexExists = indexes.some(idx => idx.name === "meeting_artifacts_readable_id_unique");
  
  if (!indexExists) {
    // Create index for faster lookups
    await queryInterface.addIndex("meeting_artifacts", ["readableId"], {
      unique: true,
      name: "meeting_artifacts_readable_id_unique",
    });
  }
  
  // Generate readable IDs for existing artifacts based on their creation date
  const artifacts = await queryInterface.sequelize.query(
    `SELECT id, "createdAt" FROM meeting_artifacts WHERE "readableId" IS NULL`,
    { type: Sequelize.QueryTypes.SELECT }
  );
  
  for (const artifact of artifacts) {
    const createdAt = artifact.createdAt ? new Date(artifact.createdAt) : new Date();
    const readableId = generateReadableMeetingId(createdAt);
    
    await queryInterface.sequelize.query(
      `UPDATE meeting_artifacts SET "readableId" = :readableId WHERE id = :id`,
      {
        replacements: { readableId, id: artifact.id },
        type: Sequelize.QueryTypes.UPDATE,
      }
    );
  }
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeIndex("meeting_artifacts", "meeting_artifacts_readable_id_unique");
  await queryInterface.removeColumn("meeting_artifacts", "readableId");
};


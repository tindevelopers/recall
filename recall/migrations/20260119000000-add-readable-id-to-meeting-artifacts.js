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
    
    // Retry up to 20 times to find a unique readableId
    let readableId;
    let attempts = 0;
    const maxAttempts = 20;
    let foundUnique = false;
    
    while (attempts < maxAttempts && !foundUnique) {
      readableId = generateReadableMeetingId(createdAt);
      
      // Check if this readableId already exists
      const existing = await queryInterface.sequelize.query(
        `SELECT id FROM meeting_artifacts WHERE "readableId" = :readableId LIMIT 1`,
        {
          replacements: { readableId },
          type: Sequelize.QueryTypes.SELECT,
        }
      );
      
      if (existing.length === 0) {
        // This readableId is unique, use it
        foundUnique = true;
      } else {
        attempts++;
      }
    }
    
    // If we still haven't found a unique ID after max attempts, use artifact ID suffix as fallback
    if (!foundUnique) {
      const artifactIdSuffix = artifact.id.replace(/-/g, '').slice(-3).toUpperCase();
      const year = createdAt.getFullYear();
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const day = String(createdAt.getDate()).padStart(2, '0');
      readableId = `MTG-${year}${month}${day}-${artifactIdSuffix}`;
    }
    
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


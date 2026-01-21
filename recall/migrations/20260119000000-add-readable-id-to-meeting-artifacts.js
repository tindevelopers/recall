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
    `SELECT id, "createdAt" FROM meeting_artifacts WHERE "readableId" IS NULL ORDER BY "createdAt" ASC`,
    { type: Sequelize.QueryTypes.SELECT }
  );
  
  console.log(`[MIGRATION] Backfilling readableId for ${artifacts.length} artifacts`);
  
  for (const artifact of artifacts) {
    const createdAt = artifact.createdAt ? new Date(artifact.createdAt) : new Date();
    
    // Retry up to 50 times to find a unique readableId
    let readableId;
    let attempts = 0;
    const maxAttempts = 50;
    let foundUnique = false;
    let updateSuccess = false;
    
    while (attempts < maxAttempts && !updateSuccess) {
      if (!foundUnique) {
        // Try generating a random readableId
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
          foundUnique = true;
        } else {
          attempts++;
          continue;
        }
      }
      
      // Try to update with the unique readableId
      try {
        await queryInterface.sequelize.query(
          `UPDATE meeting_artifacts SET "readableId" = :readableId WHERE id = :id AND "readableId" IS NULL`,
          {
            replacements: { readableId, id: artifact.id },
            type: Sequelize.QueryTypes.UPDATE,
          }
        );
        updateSuccess = true;
      } catch (error) {
        // If we get a unique constraint violation, the readableId was taken between check and update
        if (error.name === 'SequelizeUniqueConstraintError' || error.message?.includes('unique constraint')) {
          foundUnique = false;
          attempts++;
        } else {
          // Some other error, rethrow
          throw error;
        }
      }
    }
    
    // If we still haven't succeeded after max attempts, use UUID-based fallback
    if (!updateSuccess) {
      // Use first 8 chars of UUID (without dashes) as suffix to ensure uniqueness
      const artifactIdSuffix = artifact.id.replace(/-/g, '').substring(0, 8).toUpperCase();
      const year = createdAt.getFullYear();
      const month = String(createdAt.getMonth() + 1).padStart(2, '0');
      const day = String(createdAt.getDate()).padStart(2, '0');
      readableId = `MTG-${year}${month}${day}-${artifactIdSuffix}`;
      
      // Final attempt with UUID-based ID (should be unique since UUIDs are unique)
      try {
        await queryInterface.sequelize.query(
          `UPDATE meeting_artifacts SET "readableId" = :readableId WHERE id = :id AND "readableId" IS NULL`,
          {
            replacements: { readableId, id: artifact.id },
            type: Sequelize.QueryTypes.UPDATE,
          }
        );
      } catch (error) {
        // Even UUID-based fallback failed (shouldn't happen), log and continue
        console.error(`[MIGRATION] Failed to set readableId for artifact ${artifact.id}:`, error.message);
      }
    }
  }
  
  console.log(`[MIGRATION] Completed backfilling readableId`);
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeIndex("meeting_artifacts", "meeting_artifacts_readable_id_unique");
  await queryInterface.removeColumn("meeting_artifacts", "readableId");
};


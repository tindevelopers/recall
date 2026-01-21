"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  // Add readableId column to meeting_artifacts
  await queryInterface.addColumn("meeting_artifacts", "readableId", {
    type: Sequelize.STRING,
    allowNull: true,
    unique: true,
  });
  
  // Create index for faster lookups
  await queryInterface.addIndex("meeting_artifacts", ["readableId"], {
    unique: true,
    name: "meeting_artifacts_readable_id_unique",
  });
  
  // Generate readable IDs for existing artifacts based on their creation date
  const artifacts = await queryInterface.sequelize.query(
    `SELECT id, "createdAt" FROM meeting_artifacts WHERE "readableId" IS NULL`,
    { type: Sequelize.QueryTypes.SELECT }
  );
  
  for (const artifact of artifacts) {
    const createdAt = artifact.createdAt ? new Date(artifact.createdAt) : new Date();
    const year = createdAt.getFullYear();
    const month = String(createdAt.getMonth() + 1).padStart(2, '0');
    const day = String(createdAt.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    const randomHex = Math.floor(Math.random() * 4096).toString(16).toUpperCase().padStart(3, '0');
    const readableId = `MTG-${dateStr}-${randomHex}`;
    
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


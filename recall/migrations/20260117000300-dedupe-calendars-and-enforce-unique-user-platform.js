"use strict";

// Deduplicate calendars so each user can have at most one per platform,
// then enforce it with a unique index. This prevents accidental double-connects
// that create multiple Recall calendar IDs for the same user/platform.

export const up = async ({ context: { queryInterface } }) => {
  // 1) Deduplicate calendars, keeping the most recently updated per (userId, platform).
  const [rows] = await queryInterface.sequelize.query(
    `SELECT id, "userId" as "userId", platform, "updatedAt" as "updatedAt"
     FROM calendars
     ORDER BY "updatedAt" DESC`
  );

  const keepByKey = new Map(); // key -> calendarId to keep
  const dedupePairs = []; // { keepId, deleteId }

  for (const row of rows) {
    const key = `${row.userId}:${row.platform}`;
    if (!keepByKey.has(key)) {
      keepByKey.set(key, row.id);
    } else {
      dedupePairs.push({ keepId: keepByKey.get(key), deleteId: row.id });
    }
  }

  for (const { keepId, deleteId } of dedupePairs) {
    // Move dependent rows to the kept calendar to avoid data loss.
    await queryInterface.sequelize.query(
      `UPDATE calendar_events SET "calendarId" = :keepId WHERE "calendarId" = :deleteId`,
      { replacements: { keepId, deleteId } }
    );
    await queryInterface.sequelize.query(
      `UPDATE calendar_webhooks SET "calendarId" = :keepId WHERE "calendarId" = :deleteId`,
      { replacements: { keepId, deleteId } }
    );
    await queryInterface.sequelize.query(
      `DELETE FROM calendars WHERE id = :deleteId`,
      { replacements: { deleteId } }
    );
  }

  // 2) Enforce uniqueness going forward.
  await queryInterface.addIndex("calendars", ["userId", "platform"], {
    unique: true,
    name: "calendars_userId_platform_unique",
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeIndex("calendars", "calendars_userId_platform_unique");
};


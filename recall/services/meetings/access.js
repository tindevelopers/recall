import db from "../../db.js";

export function buildAccessSql({
  userId,
  userEmail,
  artifactAlias = '"ma"',
}) {
  const conditions = [
    `${artifactAlias}."ownerUserId" = :userId`,
    `${artifactAlias}."userId" = :userId`,
  ];

  const emailClause =
    userEmail && userEmail.trim().length > 0
      ? ` OR LOWER(ms."sharedWithEmail") = :userEmail`
      : "";

  conditions.push(`
    EXISTS (
      SELECT 1 FROM meeting_shares ms
      WHERE ms."meetingArtifactId" = ${artifactAlias}.id
        AND ms.status = 'accepted'
        AND (ms."sharedWithUserId" = :userId${emailClause})
    )
  `);

  return conditions.map((c) => `(${c})`).join(" OR ");
}

/**
 * Check if a string is a valid UUID format
 */
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

export async function findAccessibleArtifact({
  meetingIdOrReadableId,
  userId,
  userEmail,
}) {
  if (!meetingIdOrReadableId) return null;

  const accessSql = buildAccessSql({
    userId,
    userEmail: userEmail?.toLowerCase?.(),
    artifactAlias: "ma",
  });

  const replacements = {
    userId,
    userEmail: userEmail?.toLowerCase?.(),
    meetingId: meetingIdOrReadableId,
  };

  // Build WHERE clause conditionally based on whether meetingId is a UUID
  // If it's a UUID, check both id and readableId. If it's not, only check readableId
  // This prevents PostgreSQL from trying to cast readable IDs to UUID type
  const isUUID = isValidUUID(meetingIdOrReadableId);
  const whereClause = isUUID
    ? `(ma.id = :meetingId OR ma."readableId" = :meetingId)`
    : `ma."readableId" = :meetingId`;

  const result = await db.sequelize.query(
    `
      SELECT ma.*
      FROM meeting_artifacts ma
      WHERE ${whereClause}
        AND (${accessSql})
      LIMIT 1;
    `,
    { replacements, type: db.Sequelize.QueryTypes.SELECT }
  );

  return result?.[0] || null;
}


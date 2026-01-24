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

  const result = await db.sequelize.query(
    `
      SELECT ma.*
      FROM meeting_artifacts ma
      WHERE (ma.id = :meetingId OR ma."readableId" = :meetingId)
        AND (${accessSql})
      LIMIT 1;
    `,
    { replacements, type: db.Sequelize.QueryTypes.SELECT }
  );

  return result?.[0] || null;
}


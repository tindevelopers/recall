/**
 * Dev script: verifies that pgvector embeddings are stored correctly and usable in <=> queries.
 * Usage:
 *   DATABASE_URL=... node scripts/verify-embeddings.js
 *   MEETING_ID=<uuid-or-readableId> DATABASE_URL=... node scripts/verify-embeddings.js
 */
import { connect } from "../db.js";
import db from "../db.js";

async function main() {
  const meetingId = process.env.MEETING_ID || null;
  await connect();

  const whereClause = [
    "mtc.embedding IS NOT NULL",
    meetingId ? 'mtc."meetingArtifactId" = :meetingId' : null,
  ]
    .filter(Boolean)
    .join(" AND ");

  const rows = await db.sequelize.query(
    `
      SELECT mtc.id,
             mtc."meetingArtifactId",
             mtc.embedding <=> mtc.embedding AS self_distance
      FROM meeting_transcript_chunks mtc
      WHERE ${whereClause}
      LIMIT 1;
    `,
    {
      replacements: { meetingId },
      type: db.Sequelize.QueryTypes.SELECT,
    }
  );

  if (!rows.length) {
    console.log(
      meetingId
        ? `No embedded chunks found for meetingArtifactId=${meetingId}`
        : "No embedded chunks found"
    );
    return;
  }

  const row = rows[0];
  console.log(
    `Found embedded chunk ${row.id} for meeting ${row.meetingArtifactId}; self-distance=${row.self_distance}`
  );
  if (Number(row.self_distance) !== 0) {
    throw new Error("Self-distance is not zero; embedding may not be stored correctly.");
  }

  console.log("Embedding round-trip looks good.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  });


import db from "../../db.js";
import { embed } from "../../services/openai/index.js";

const BATCH_SIZE = 50;

function isValidText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export default async (job) => {
  const { meetingArtifactId } = job.data || {};
  if (!meetingArtifactId) {
    console.warn("[meeting.embed_chunks] Missing meetingArtifactId");
    return;
  }

  console.log(`[meeting.embed_chunks] Starting for artifact ${meetingArtifactId}`);

  const chunks = await db.MeetingTranscriptChunk.findAll({
    where: { meetingArtifactId, embedding: null },
    order: [["sequence", "ASC"]],
  });

  const missing = chunks.filter((c) => isValidText(c.text));
  if (!missing.length) {
    console.log(`[meeting.embed_chunks] No missing embeddings for ${meetingArtifactId}`);
    return;
  }

  console.log(
    `[meeting.embed_chunks] Embedding ${missing.length} chunks for artifact ${meetingArtifactId}`
  );

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text.trim());
    try {
      const embeddings = await embed(texts);
      await Promise.all(
        batch.map((chunk, idx) =>
          chunk.update({ embedding: embeddings[idx] || null })
        )
      );
    } catch (err) {
      console.error(
        `[meeting.embed_chunks] Failed embedding batch (${i}):`,
        err?.message || err
      );
      throw err;
    }
  }

  console.log(
    `[meeting.embed_chunks] Completed embedding for artifact ${meetingArtifactId}`
  );
};


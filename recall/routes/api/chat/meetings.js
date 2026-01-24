import db from "../../../db.js";
import { embed } from "../../../services/openai/index.js";
import { chatWithRouter } from "../../../services/query-router/index.js";
import { cacheGet, cacheSet, hashKey } from "../../../services/cache/index.js";

function cosineSimilarity(a = [], b = []) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function isValidText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function buildAnswerPrompt(query, contexts) {
  const contextText = contexts
    .map(
      (c) =>
        `Chunk ${c.id} (meeting ${c.calendarEventId || "unknown"}): ${c.text}`
    )
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "You are a helpful assistant that answers questions about the user's meetings. Use only the provided context and be concise. If unsure, say you don't know.",
    },
    {
      role: "user",
      content: `Context:\n${contextText}\n\nQuestion: ${query}`,
    },
  ];
}

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const rawQuery = req.body?.query || req.body?.q;
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const userId = req.authentication.user.id;
  const meetingArtifactId = req.body?.meetingArtifactId || req.body?.meetingId;
  const calendarEventId = req.body?.calendarEventId;
  const chunks = await db.MeetingTranscriptChunk.findAll({
    where: { userId },
    limit: 500,
  });

  if (!chunks.length) {
    return res.status(200).json({ answer: "No meeting transcripts available yet." });
  }

  // Ensure chunk embeddings (skip invalid/empty texts)
  const validChunks = chunks.filter((c) => isValidText(c.text));
  const chunksNeedingEmbedding = validChunks.filter((c) => !c.embedding);
  if (chunksNeedingEmbedding.length) {
    try {
      const embeds = await embed(chunksNeedingEmbedding.map((c) => c.text.trim()));
      await Promise.all(
        chunksNeedingEmbedding.map((c, idx) =>
          c.update({ embedding: embeds[idx] || null })
        )
      );
    } catch (err) {
      console.error("[chat/meetings] embedding chunks failed:", err?.message || err);
      return res
        .status(500)
        .json({ error: "Failed to generate embeddings for meeting chunks" });
    }
  }

  const queryEmbeddingCacheKey = `embed:query:${hashKey(query)}`;
  let queryEmbedding = await cacheGet(queryEmbeddingCacheKey);
  if (!queryEmbedding) {
    try {
      queryEmbedding = (await embed([query]))?.[0];
      if (queryEmbedding) {
        await cacheSet(queryEmbeddingCacheKey, queryEmbedding, 60 * 60); // 1 hour
      }
    } catch (err) {
      console.error("[chat/meetings] embedding query failed:", err?.message || err);
      return res
        .status(500)
        .json({ error: "Failed to generate embedding for query" });
    }
  }

  if (!queryEmbedding) {
    return res.status(500).json({ error: "Unable to compute query embedding" });
  }

  const queryVector = `[${queryEmbedding.join(",")}]`;

  const whereClauses = ['"userId" = :userId', "embedding IS NOT NULL"];
  const replacements = { queryVec: queryVector, userId };

  if (meetingArtifactId) {
    whereClauses.push('"meetingArtifactId" = :meetingArtifactId');
    replacements.meetingArtifactId = meetingArtifactId;
  }

  if (calendarEventId) {
    whereClauses.push('"calendarEventId" = :calendarEventId');
    replacements.calendarEventId = calendarEventId;
  }

  // Use PostgreSQL vector operator for similarity search
  const topContexts = await db.sequelize.query(
    `
    SELECT id, "calendarEventId", "meetingArtifactId", "userId", sequence, "startTimeMs",
           "endTimeMs", speaker, text, embedding <=> CAST(:queryVec AS vector) AS distance
    FROM meeting_transcript_chunks
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY embedding <=> CAST(:queryVec AS vector)
    LIMIT 8;
    `,
    {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    }
  );

  if (!topContexts.length) {
    return res.status(200).json({ answer: "No matching meeting transcripts available for this query." });
  }

  const answerCacheKey = `answer:${hashKey(
    `${query}|${topContexts.map((c) => c.id).join(",")}`
  )}`;
  const cachedAnswer = await cacheGet(answerCacheKey);
  if (cachedAnswer) {
    return res.status(200).json({ answer: cachedAnswer, cached: true });
  }

  const prompt = buildAnswerPrompt(query, topContexts);
  const { response: answer } = await chatWithRouter(prompt, { query });

  await cacheSet(answerCacheKey, answer, 60 * 15); // cache answers for 15 minutes

  return res.status(200).json({ answer });
};



import db from "../../../db.js";
import { embed } from "../../../services/openai/index.js";
import { chatWithRouter } from "../../../services/query-router/index.js";
import { cacheGet, cacheSet, hashKey } from "../../../services/cache/index.js";
import { backgroundQueue } from "../../../queue.js";
import {
  buildAccessSql,
  findAccessibleArtifact,
} from "../../../services/meetings/access.js";

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
  const userEmail = req.authentication.user.email || null;
  const meetingArtifactId = req.body?.meetingArtifactId || req.body?.meetingId;
  const calendarEventId = req.body?.calendarEventId;

  if (meetingArtifactId) {
    const artifact = await findAccessibleArtifact({
      meetingIdOrReadableId: meetingArtifactId,
      userId,
      userEmail,
    });
    if (!artifact) {
      return res
        .status(404)
        .json({ error: "Meeting not found or you don't have access." });
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

  const accessSql = buildAccessSql({
    userId,
    userEmail: userEmail?.toLowerCase(),
    artifactAlias: "ma",
  });

  const whereClauses = ["mtc.embedding IS NOT NULL", `(${accessSql})`];
  const replacements = {
    queryVec: queryVector,
    userId,
    userEmail: userEmail?.toLowerCase(),
  };

  if (meetingArtifactId) {
    whereClauses.push('mtc."meetingArtifactId" = :meetingArtifactId');
    replacements.meetingArtifactId = meetingArtifactId;
  } else {
    whereClauses.push("ma.status IN ('completed','done','enriched')");
  }

  if (calendarEventId) {
    whereClauses.push('mtc."calendarEventId" = :calendarEventId');
    replacements.calendarEventId = calendarEventId;
  }

  // Ensure we actually have embeddings to search; if not, queue embed job(s)
  const countResult = await db.sequelize.query(
    `
      SELECT COUNT(*)::int AS count
      FROM meeting_transcript_chunks mtc
      JOIN meeting_artifacts ma ON ma.id = mtc."meetingArtifactId"
      WHERE ${whereClauses.join(" AND ")};
    `,
    { replacements, type: db.Sequelize.QueryTypes.SELECT }
  );

  const embeddingCount = countResult?.[0]?.count || 0;
  if (embeddingCount === 0) {
    if (meetingArtifactId) {
      try {
        await backgroundQueue.add(
          "meeting.embed_chunks",
          { meetingArtifactId },
          { jobId: `embed-${meetingArtifactId}`, removeOnComplete: true }
        );
      } catch (err) {
        console.warn(
          `[chat/meetings] Failed to enqueue embed job for ${meetingArtifactId}:`,
          err?.message || err
        );
      }
      return res.status(202).json({
        answer:
          "Indexing this meeting's transcript. Please try again in a moment.",
        indexing: true,
      });
    }

    // Global: queue a few accessible meetings that lack embeddings
    const meetingsNeedingEmbeds = await db.sequelize.query(
      `
        SELECT ma.id
        FROM meeting_artifacts ma
        JOIN meeting_transcript_chunks mtc ON mtc."meetingArtifactId" = ma.id
        WHERE (${accessSql})
          AND ma.status IN ('completed','done','enriched')
        GROUP BY ma.id
        HAVING SUM(CASE WHEN mtc.embedding IS NOT NULL THEN 1 ELSE 0 END) = 0
        LIMIT 3;
      `,
      {
        replacements,
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    for (const row of meetingsNeedingEmbeds || []) {
      try {
        await backgroundQueue.add(
          "meeting.embed_chunks",
          { meetingArtifactId: row.id },
          { jobId: `embed-${row.id}`, removeOnComplete: true }
        );
      } catch (err) {
        console.warn(
          `[chat/meetings] Failed to enqueue embed job for ${row.id}:`,
          err?.message || err
        );
      }
    }

    return res.status(200).json({
      answer: "No indexed meeting transcripts available yet.",
    });
  }

  // Use PostgreSQL vector operator for similarity search
  const topContexts = await db.sequelize.query(
    `
    SELECT mtc.id, mtc."calendarEventId", mtc."meetingArtifactId", mtc."userId", mtc.sequence, mtc."startTimeMs",
           mtc."endTimeMs", mtc.speaker, mtc.text, mtc.embedding <=> CAST(:queryVec AS vector) AS distance
    FROM meeting_transcript_chunks mtc
    JOIN meeting_artifacts ma ON ma.id = mtc."meetingArtifactId"
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY mtc.embedding <=> CAST(:queryVec AS vector)
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



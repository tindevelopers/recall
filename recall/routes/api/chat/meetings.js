import db from "../../../db.js";
import { chatCompletion, embed } from "../../../services/openai/index.js";

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

  const query = req.body?.query || req.body?.q;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const userId = req.authentication.user.id;
  const chunks = await db.MeetingTranscriptChunk.findAll({
    where: { userId },
    limit: 500,
  });

  if (!chunks.length) {
    return res.status(200).json({ answer: "No meeting transcripts available yet." });
  }

  // Ensure chunk embeddings
  const chunksNeedingEmbedding = chunks.filter((c) => !c.embedding);
  if (chunksNeedingEmbedding.length) {
    const embeds = await embed(chunksNeedingEmbedding.map((c) => c.text));
    await Promise.all(
      chunksNeedingEmbedding.map((c, idx) =>
        c.update({ embedding: embeds[idx] || null })
      )
    );
  }

  const queryEmbedding = (await embed([query]))[0];
  const scored = chunks.map((c) => ({
    chunk: c,
    score: cosineSimilarity(queryEmbedding, c.embedding || []),
  }));

  const topContexts = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.chunk);

  const prompt = buildAnswerPrompt(query, topContexts);
  const answer = await chatCompletion(prompt, { responseFormat: null });

  return res.status(200).json({ answer });
};



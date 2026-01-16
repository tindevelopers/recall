import db from "../../db.js";
import { chatCompletion, embed } from "../../services/openai/index.js";
import { v4 as uuidv4 } from "uuid";

function buildPrompt(transcriptText, metadata = {}) {
  const title = metadata?.title || "Meeting";
  const participants = metadata?.participants || [];
  const when = metadata?.startTime || "";
  return [
    {
      role: "system",
      content:
        "You are an expert meeting summarizer. Produce concise outputs with clear action items and follow-ups. Return valid JSON.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          title,
          when,
          participants,
          transcript: transcriptText,
        },
        null,
        2
      ),
    },
  ];
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

async function ensureChunkEmbeddings(chunks) {
  const missing = chunks.filter((c) => !c.embedding);
  if (!missing.length) return;

  const texts = missing.map((c) => c.text);
  const embeddings = await embed(texts);
  await Promise.all(
    missing.map((chunk, idx) =>
      chunk.update({ embedding: embeddings[idx] || null })
    )
  );
}

export default async (job) => {
  const { meetingArtifactId } = job.data;
  const artifact = await db.MeetingArtifact.findByPk(meetingArtifactId, {
    include: [
      {
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      },
    ],
  });

  if (!artifact) {
    console.warn(
      `WARN: meeting.enrich could not find artifact ${meetingArtifactId}`
    );
    return;
  }

  const calendarEvent = artifact.CalendarEvent;
  const userId = artifact.userId || calendarEvent?.Calendar?.userId || null;

  const chunks = await db.MeetingTranscriptChunk.findAll({
    where: { meetingArtifactId: artifact.id },
    order: [["sequence", "ASC"]],
  });

  const transcriptText =
    chunks.length > 0
      ? chunks.map((c) => c.text).join("\n")
      : JSON.stringify(artifact.rawPayload);

  const metadata = {
    title: calendarEvent?.title || artifact.rawPayload?.data?.title,
    startTime: calendarEvent?.startTime || artifact.rawPayload?.data?.start_time,
    participants:
      artifact.rawPayload?.data?.participants ||
      artifact.rawPayload?.data?.attendees ||
      [],
  };

  const prompt = buildPrompt(transcriptText, metadata);

  const response = await chatCompletion(prompt, {
    responseFormat: "json_object",
  });

  const parsed = safeParseJson(response) || {};

  const summaryPayload = {
    id: uuidv4(),
    meetingArtifactId: artifact.id,
    calendarEventId: calendarEvent?.id || null,
    userId,
    status: "completed",
    summary: parsed.summary || parsed.overview || "",
    actionItems: parsed.action_items || parsed.actions || [],
    followUps: parsed.follow_ups || parsed.followups || [],
    topics: parsed.topics || parsed.key_points || [],
  };

  const [meetingSummary] = await db.MeetingSummary.upsert(summaryPayload, {
    returning: true,
  });

  await ensureChunkEmbeddings(chunks);

  // mark artifact status
  await artifact.update({ status: "enriched" });

  // enqueue publishing
  job.queue.add("publishing.dispatch", {
    meetingSummaryId: meetingSummary.id || meetingSummary?.dataValues?.id,
  });
};



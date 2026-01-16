import db from "../../db.js";
import { chatCompletion, embed } from "../../services/openai/index.js";
import { v4 as uuidv4 } from "uuid";

function buildPrompt(transcriptText, metadata = {}, settings = {}) {
  const title = metadata?.title || "Meeting";
  const participants = metadata?.participants || [];
  const when = metadata?.startTime || "";
  
  // Build the request based on what enrichment features are enabled
  const requestedOutputs = [];
  if (settings.enableSummary !== false) {
    requestedOutputs.push("summary: A concise summary of the key discussion points");
  }
  if (settings.enableActionItems !== false) {
    requestedOutputs.push("action_items: Array of specific tasks/assignments mentioned, each with 'task', 'assignee' (if mentioned), and 'due_date' (if mentioned)");
  }
  if (settings.enableFollowUps !== false) {
    requestedOutputs.push("follow_ups: Array of suggested follow-up items and next steps");
  }
  requestedOutputs.push("topics: Array of main topics/themes discussed");
  
  const systemPrompt = `You are an expert meeting summarizer. Analyze the meeting transcript and produce the following outputs:
${requestedOutputs.map((o, i) => `${i + 1}. ${o}`).join("\n")}

Return valid JSON with these fields. Be concise but thorough.`;

  return [
    {
      role: "system",
      content: systemPrompt,
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
  const calendar = calendarEvent?.Calendar;
  const userId = artifact.userId || calendar?.userId || null;

  // Get calendar settings for AI enrichment
  const enrichmentSettings = {
    enableSummary: calendar?.enableSummary !== false,
    enableActionItems: calendar?.enableActionItems !== false,
    enableFollowUps: calendar?.enableFollowUps !== false,
    autoPublishToNotion: calendar?.autoPublishToNotion === true,
  };

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

  const prompt = buildPrompt(transcriptText, metadata, enrichmentSettings);

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
    summary: enrichmentSettings.enableSummary ? (parsed.summary || parsed.overview || "") : "",
    actionItems: enrichmentSettings.enableActionItems ? (parsed.action_items || parsed.actions || []) : [],
    followUps: enrichmentSettings.enableFollowUps ? (parsed.follow_ups || parsed.followups || []) : [],
    topics: parsed.topics || parsed.key_points || [],
  };

  const [meetingSummary] = await db.MeetingSummary.upsert(summaryPayload, {
    returning: true,
  });

  await ensureChunkEmbeddings(chunks);

  // mark artifact status
  await artifact.update({ status: "enriched" });

  // enqueue publishing only if auto-publish is enabled
  if (enrichmentSettings.autoPublishToNotion) {
    job.queue.add("publishing.dispatch", {
      meetingSummaryId: meetingSummary.id || meetingSummary?.dataValues?.id,
    });
  } else {
    console.log(`INFO: Auto-publish disabled for calendar, skipping publishing dispatch`);
  }
};



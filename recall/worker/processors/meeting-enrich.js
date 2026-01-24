import db from "../../db.js";
import { embed } from "../../services/openai/index.js";
import Notepad from "../../services/notepad/index.js";
import { v4 as uuidv4 } from "uuid";

// Removed buildPrompt and safeParseJson - now handled by Notepad service

function isValidText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function ensureChunkEmbeddings(chunks) {
  const missing = chunks.filter((c) => !c.embedding && isValidText(c.text));
  if (!missing.length) return;

  const texts = missing.map((c) => c.text.trim());
  try {
    const embeddings = await embed(texts);
    await Promise.all(
      missing.map((chunk, idx) =>
        chunk.update({ embedding: embeddings[idx] || null })
      )
    );
  } catch (err) {
    console.error("[meeting-enrich] embedding chunks failed:", err?.message || err);
    // Do not throw to avoid failing the entire job; leave embeddings null
  }
}

export default async (job) => {
  const { meetingArtifactId, publishAfterEnrich, notionOverride } = job.data;
  
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

  const validChunkTexts = chunks.filter((c) => isValidText(c.text)).map((c) => c.text.trim());
  const transcriptText =
    validChunkTexts.length > 0
      ? validChunkTexts.join("\n")
      : JSON.stringify(artifact.rawPayload);

  const metadata = {
    title: calendarEvent?.title || artifact.rawPayload?.data?.title,
    startTime: calendarEvent?.startTime || artifact.rawPayload?.data?.start_time,
    participants:
      artifact.rawPayload?.data?.participants ||
      artifact.rawPayload?.data?.attendees ||
      [],
  };

  // Use Notepad service: tries Recall.ai Notepad API first, falls back to OpenAI
  console.log(`[ENRICH] Fetching summary and action items using Notepad service...`);
  
  const notepadResult = await Notepad.getSummaryAndActionItems({
    transcriptText,
    metadata,
    settings: enrichmentSettings,
    recallBotId: artifact.recallBotId,
    recallEventId: artifact.recallEventId,
    webhookPayload: artifact.rawPayload,
  });

  console.log(`[ENRICH] Notepad service returned data from source: ${notepadResult.source}`);

  const summaryPayload = {
    id: uuidv4(),
    meetingArtifactId: artifact.id,
    calendarEventId: calendarEvent?.id || null,
    userId,
    status: "completed",
    summary: enrichmentSettings.enableSummary ? (notepadResult.summary || "") : "",
    actionItems: enrichmentSettings.enableActionItems ? (notepadResult.actionItems || []) : [],
    followUps: enrichmentSettings.enableFollowUps ? (notepadResult.followUps || []) : [],
    topics: notepadResult.topics || [],
    // Sentiment and insights
    sentiment: notepadResult.sentiment || null,
    keyInsights: notepadResult.keyInsights || [],
    decisions: notepadResult.decisions || [],
    outcome: notepadResult.outcome || null,
    // Store the source for debugging/transparency
    source: notepadResult.source || "unknown",
  };

  const [meetingSummary] = await db.MeetingSummary.upsert(summaryPayload, {
    returning: true,
  });
  

  await ensureChunkEmbeddings(chunks);

  // mark artifact status
  await artifact.update({ status: "enriched" });

  // If publishAfterEnrich is set (from manual publish with override), always publish
  if (publishAfterEnrich && notionOverride) {
    console.log(`INFO: Publishing to Notion with override after enrichment`);
    job.queue.add("publishing.dispatch", {
      meetingSummaryId: meetingSummary.id || meetingSummary?.dataValues?.id,
      notionOverride,
    });
  }
  // Otherwise, enqueue publishing only if auto-publish is enabled
  else if (enrichmentSettings.autoPublishToNotion) {
    job.queue.add("publishing.dispatch", {
      meetingSummaryId: meetingSummary.id || meetingSummary?.dataValues?.id,
    });
  } else {
    console.log(`INFO: Auto-publish disabled for calendar, skipping publishing dispatch`);
  }
};



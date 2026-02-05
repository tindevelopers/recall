import db from "../../db.js";
import { embed } from "../../services/openai/index.js";
import Notepad from "../../services/notepad/index.js";
import AISummarizer from "../../services/ai-summarizer/index.js";
import { backgroundQueue } from "../../queue.js";
import { v4 as uuidv4 } from "uuid";

// Removed buildPrompt and safeParseJson - now handled by Notepad service

function isValidText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function estimateDurationMs(chunk) {
  if (
    typeof chunk.startTimeMs === "number" &&
    typeof chunk.endTimeMs === "number" &&
    chunk.endTimeMs > chunk.startTimeMs
  ) {
    return chunk.endTimeMs - chunk.startTimeMs;
  }
  // Fallback: estimate based on word count (~120 wpm => 500ms per word)
  const wordCount = chunk.text ? chunk.text.trim().split(/\s+/).length : 0;
  return wordCount * 500;
}

function computeTalkStats(chunks) {
  const totals = new Map();
  let totalDurationMs = 0;

  chunks.forEach((chunk) => {
    const speaker = chunk.speaker || "Unknown";
    const durationMs = estimateDurationMs(chunk);
    const wordCount = chunk.text ? chunk.text.trim().split(/\s+/).length : 0;
    const entry = totals.get(speaker) || { talkTimeMs: 0, turns: 0, wordCount: 0 };
    entry.talkTimeMs += durationMs;
    entry.turns += 1;
    entry.wordCount += wordCount;
    totals.set(speaker, entry);
    totalDurationMs += durationMs;
  });

  const speakers = Array.from(totals.entries()).map(([name, data]) => {
    const talkTimeSeconds = data.talkTimeMs / 1000;
    return {
      name,
      talkTimeSeconds,
      talkTimePercent: totalDurationMs ? (data.talkTimeMs / totalDurationMs) * 100 : null,
      turns: data.turns,
      wordCount: data.wordCount,
    };
  });

  return {
    durationSeconds: totalDurationMs / 1000,
    speakers,
  };
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
  
  console.log(`[ENRICH] Starting enrichment job for artifact ${meetingArtifactId}`);
  
  try {
    const artifact = await db.MeetingArtifact.findByPk(meetingArtifactId, {
      include: [
        {
          model: db.CalendarEvent,
          include: [{ model: db.Calendar }],
        },
      ],
    });

    if (!artifact) {
      console.error(
        `[ENRICH] ERROR: Could not find artifact ${meetingArtifactId}`
      );
      throw new Error(`Artifact ${meetingArtifactId} not found`);
    }
    
    console.log(`[ENRICH] Found artifact ${artifact.id}, checking transcript chunks...`);

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

  // Get AI provider and model from calendar settings
  const aiProvider = calendar?.aiProvider || "recall";
  const aiModel = calendar?.aiModel || null;

  const chunks = await db.MeetingTranscriptChunk.findAll({
    where: { meetingArtifactId: artifact.id },
    order: [["sequence", "ASC"]],
  });

  console.log(`[ENRICH] Found ${chunks.length} transcript chunks for artifact ${artifact.id}`);

  // Format transcript with speaker attribution for better AI understanding
  const validChunks = chunks.filter((c) => isValidText(c.text));
  const transcriptText =
    validChunks.length > 0
      ? validChunks
          .map((c) => {
            const speaker = c.speaker || "Unknown Speaker";
            return `${speaker}: ${c.text.trim()}`;
          })
          .join("\n\n")
      : null;

  if (!transcriptText || transcriptText.trim().length === 0) {
    console.error(`[ENRICH] ERROR: No valid transcript text found for artifact ${artifact.id}`);
    console.error(`[ENRICH] Chunks: ${chunks.length}, Valid chunks: ${validChunks.length}`);
    throw new Error(`No transcript available for artifact ${artifact.id}. Cannot generate summary without transcript.`);
  }
  
  console.log(`[ENRICH] Transcript text length: ${transcriptText.length} characters`);

  const talkStats = computeTalkStats(chunks);

  const metadata = {
    title: calendarEvent?.title || artifact.rawPayload?.data?.title,
    startTime: calendarEvent?.startTime || artifact.rawPayload?.data?.start_time,
    participants:
      artifact.rawPayload?.data?.participants ||
      artifact.rawPayload?.data?.attendees ||
      [],
    speakerStats: talkStats.speakers,
    durationSeconds: talkStats.durationSeconds,
  };

  // Use AI Summarizer abstraction layer with configured provider/model
  console.log(`[ENRICH] Fetching summary using provider: ${aiProvider}, model: ${aiModel || "default"}`);
  console.log(`[ENRICH] Enrichment settings:`, JSON.stringify(enrichmentSettings));
  console.log(`[ENRICH] Metadata:`, JSON.stringify({ title: metadata.title, participantsCount: metadata.participants?.length || 0, durationSeconds: metadata.durationSeconds }));
  
  let notepadResult;
  try {
    notepadResult = await AISummarizer.summarize({
      provider: aiProvider,
      model: aiModel,
      transcriptText,
      metadata,
      settings: enrichmentSettings,
      recallBotId: artifact.recallBotId,
      recallEventId: artifact.recallEventId,
      webhookPayload: artifact.rawPayload,
    });
    console.log(`[ENRICH] AI Summarizer returned data from source: ${notepadResult.source}`);
    console.log(`[ENRICH] Summary length: ${notepadResult.summary?.length || 0} chars, Action items: ${notepadResult.actionItems?.length || 0}`);
  } catch (summarizeError) {
    console.error(`[ENRICH] ERROR: Failed to generate summary:`, summarizeError);
    console.error(`[ENRICH] Error stack:`, summarizeError.stack);
    throw summarizeError;
  }

  // Normalize stats: prefer AI output, but fill gaps with computed talkStats
  const aiStats = notepadResult.stats || {};
  const normalizedAiSpeakers =
    aiStats.speakers ||
    aiStats.speaker_stats ||
    aiStats.speakerStats ||
    [];

  const mergedSpeakers =
    (normalizedAiSpeakers.length ? normalizedAiSpeakers : talkStats.speakers).map((s) => {
      const name = s.name || s.speaker || "Unknown";
      const talkTimeSeconds =
        s.talk_time_seconds ?? s.talkTimeSeconds ?? s.duration_seconds ?? null;
      const talkTimePercent =
        s.talk_time_percent ?? s.talkTimePercent ?? s.percent ?? null;
      return {
        name,
        talkTimeSeconds: talkTimeSeconds ?? talkStats.speakers.find((t) => t.name === name)?.talkTimeSeconds ?? null,
        talkTimePercent:
          talkTimePercent ??
          talkStats.speakers.find((t) => t.name === name)?.talkTimePercent ??
          null,
        turns: s.turns ?? s.speaking_turns ?? s.turn_count ?? null,
        wordCount: s.wordCount ?? s.word_count ?? null,
      };
    });

  const mergedStats = {
    durationSeconds:
      aiStats.duration_seconds ??
      aiStats.durationSeconds ??
      aiStats.duration ??
      talkStats.durationSeconds ??
      null,
    speakers: mergedSpeakers,
    note: aiStats.note || aiStats.notes || undefined,
  };

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
    highlights: notepadResult.highlights || [],
    detailedNotes: notepadResult.detailedNotes || [],
    // Sentiment and insights
    sentiment: notepadResult.sentiment || null,
    keyInsights: notepadResult.keyInsights || [],
    decisions: notepadResult.decisions || [],
    outcome: notepadResult.outcome || null,
    stats: mergedStats,
    // Store the source for debugging/transparency
    source: notepadResult.source || "unknown",
  };

  const [meetingSummary] = await db.MeetingSummary.upsert(summaryPayload, {
    returning: true,
  });
  

  await ensureChunkEmbeddings(chunks);

  // Kick off a dedicated embed job to backfill any remaining missing embeddings
  try {
    await backgroundQueue.add(
      "meeting.embed_chunks",
      { meetingArtifactId: artifact.id },
      { jobId: `embed-${artifact.id}`, removeOnComplete: true, removeOnFail: false }
    );
  } catch (err) {
    console.warn(
      `[meeting.enrich] Failed to enqueue embed job for artifact ${artifact.id}:`,
      err?.message || err
    );
  }

  // mark artifact status
  await artifact.update({ status: "enriched" });
  console.log(`[ENRICH] Successfully completed enrichment for artifact ${artifact.id}`);

  // If publishAfterEnrich is set (from manual publish with override), always publish
  if (publishAfterEnrich && notionOverride) {
    console.log(`[ENRICH] Publishing to Notion with override after enrichment`);
    job.queue.add("publishing.dispatch", {
      meetingSummaryId: meetingSummary.id || meetingSummary?.dataValues?.id,
      notionOverride,
    });
  }
  // Otherwise, enqueue publishing only if auto-publish is enabled
  else if (enrichmentSettings.autoPublishToNotion) {
    console.log(`[ENRICH] Auto-publish enabled, dispatching publishing job`);
    job.queue.add("publishing.dispatch", {
      meetingSummaryId: meetingSummary.id || meetingSummary?.dataValues?.id,
    });
  } else {
    console.log(`[ENRICH] Auto-publish disabled for calendar, skipping publishing dispatch`);
  }
  } catch (error) {
    console.error(`[ENRICH] FATAL ERROR in enrichment job for artifact ${meetingArtifactId}:`, error);
    console.error(`[ENRICH] Error message:`, error.message);
    console.error(`[ENRICH] Error stack:`, error.stack);
    throw error; // Re-throw to mark job as failed
  }
};



import db from "../../db.js";
import { embed } from "../../services/openai/index.js";
import Notepad from "../../services/notepad/index.js";
import { v4 as uuidv4 } from "uuid";

// Removed buildPrompt and safeParseJson - now handled by Notepad service

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
  // #region agent log
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/meeting-enrich.js:21',message:'Enrichment job started',data:{meetingArtifactId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  
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
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/meeting-enrich.js:32',message:'Artifact not found',data:{meetingArtifactId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
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

  // Use Notepad service: tries Recall.ai Notepad API first, falls back to OpenAI
  console.log(`[ENRICH] Fetching summary and action items using Notepad service...`);
  // #region agent log
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/meeting-enrich.js:70',message:'Starting enrichment',data:{meetingArtifactId:artifact.id,hasTranscript:chunks.length>0,transcriptLength:transcriptText.length,enrichmentSettings},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  
  const notepadResult = await Notepad.getSummaryAndActionItems({
    transcriptText,
    metadata,
    settings: enrichmentSettings,
    recallBotId: artifact.recallBotId,
    recallEventId: artifact.recallEventId,
    webhookPayload: artifact.rawPayload,
  });

  console.log(`[ENRICH] Notepad service returned data from source: ${notepadResult.source}`);
  // #region agent log
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/meeting-enrich.js:81',message:'Enrichment completed',data:{source:notepadResult.source,hasSummary:!!notepadResult.summary,actionItemsCount:notepadResult.actionItems?.length||0,followUpsCount:notepadResult.followUps?.length||0,topicsCount:notepadResult.topics?.length||0,hasSentiment:!!notepadResult.sentiment},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

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
  
  // #region agent log
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'worker/processors/meeting-enrich.js:102',message:'Summary saved to database',data:{summaryId:meetingSummary.id||meetingSummary?.dataValues?.id,hasSummary:!!summaryPayload.summary,actionItemsCount:summaryPayload.actionItems?.length||0,followUpsCount:summaryPayload.followUps?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

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



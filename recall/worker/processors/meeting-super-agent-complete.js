import db from "../../db.js";
import AssemblyAI from "../../services/assemblyai/index.js";

function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function scoreOverlap(aTokens, bTokens) {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const setB = new Set(bTokens);
  let score = 0;
  for (const token of aTokens) {
    if (setB.has(token)) score += 1;
  }
  return score;
}

function findBestTimestamp(text, utterances = []) {
  if (!text || !Array.isArray(utterances) || utterances.length === 0) return null;
  const textTokens = tokenize(text);
  let best = { score: 0, start: null };

  for (const utterance of utterances) {
    const utteranceTokens = tokenize(utterance.text || "");
    const score = scoreOverlap(textTokens, utteranceTokens);
    if (score > best.score) {
      best = { score, start: utterance.start };
    }
  }

  if (!best.start || best.score === 0) return null;
  return Math.max(0, Math.floor(best.start / 1000));
}

function attachTimestamps(items, utterances) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (typeof item.timestamp_seconds === "number") return item;
    const text =
      item.summary ||
      item.title ||
      item.task ||
      item.action ||
      item.decision ||
      item.paraphrase ||
      item.insight ||
      item.description ||
      "";
    const ts = findBestTimestamp(text, utterances);
    if (ts === null) return item;
    return { ...item, timestamp_seconds: ts };
  });
}

export default async (job) => {
  const { analysisId, transcriptId } = job.data;

  const analysis = analysisId
    ? await db.MeetingSuperAgentAnalysis.findByPk(analysisId)
    : await db.MeetingSuperAgentAnalysis.findOne({
        where: { assemblyTranscriptId: transcriptId },
        order: [["createdAt", "DESC"]],
      });

  if (!analysis) {
    console.warn(`[SuperAgent] Analysis not found for transcript ${transcriptId}`);
    return;
  }

  if (analysis.status === "completed") {
    console.log(`[SuperAgent] Analysis ${analysis.id} already completed`);
    return;
  }

  try {
    const transcript = await AssemblyAI.getTranscript(
      analysis.assemblyTranscriptId || transcriptId
    );

    if (transcript.status === "error") {
      await analysis.update({
        status: "error",
        errorMessage: transcript.error || "AssemblyAI transcription failed",
        assemblyResult: transcript,
      });
      return;
    }

    const artifact = await db.MeetingArtifact.findByPk(analysis.meetingArtifactId, {
      include: [
        {
          model: db.CalendarEvent,
          include: [{ model: db.Calendar }],
        },
      ],
    });

    const metadata = {
      title:
        artifact?.CalendarEvent?.title ||
        artifact?.rawPayload?.data?.title ||
        "Meeting",
      participants:
        artifact?.rawPayload?.data?.participants ||
        artifact?.rawPayload?.data?.attendees ||
        [],
      startTime:
        artifact?.CalendarEvent?.startTime ||
        artifact?.rawPayload?.data?.start_time ||
        null,
    };

    const summaryResult = await AssemblyAI.generateSuperAgentSummary({
      transcriptText: transcript.text || "",
      metadata,
      chapters: transcript.chapters || [],
    });

    const utterances = transcript.utterances || [];
    const highlights = attachTimestamps(summaryResult.highlights || [], utterances);
    const decisions = attachTimestamps(summaryResult.decisions || [], utterances);
    const actionItems = attachTimestamps(summaryResult.actionItems || [], utterances);

    await analysis.update({
      status: "completed",
      assemblyResult: transcript,
      detailedSummary: summaryResult.detailedSummary || "",
      actionItems,
      decisions,
      highlights,
      chapters: transcript.chapters || [],
      sentiment: transcript.sentiment_analysis_results || null,
      topics: transcript.iab_categories_result || null,
      contentSafety: transcript.content_safety_labels || null,
      translation: transcript.translated_texts || null,
      piiRedactionApplied: !!transcript.redact_pii,
      errorMessage: null,
    });

    console.log(`[SuperAgent] Analysis ${analysis.id} completed`);
  } catch (error) {
    console.error(`[SuperAgent] Failed to complete analysis ${analysis?.id}:`, error);
    await analysis.update({
      status: "error",
      errorMessage: error?.message || "Failed to complete Super Agent analysis",
    });
  }
};

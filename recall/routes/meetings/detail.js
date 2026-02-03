import db from "../../db.js";
import { Op } from "sequelize";

function estimateDurationMs(chunk) {
  if (
    typeof chunk.startTimeMs === "number" &&
    typeof chunk.endTimeMs === "number" &&
    chunk.endTimeMs > chunk.startTimeMs
  ) {
    return chunk.endTimeMs - chunk.startTimeMs;
  }
  const wordCount = chunk.text ? chunk.text.trim().split(/\s+/).length : 0;
  return wordCount * 500;
}

function computeStatsFromTranscript(chunks = []) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return null;
  }

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

export default async (req, res) => {
  // #region agent log
  const detailStartTime = Date.now();
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/detail.js:entry',message:'Detail page request started',data:{meetingId:req.params.id},timestamp:Date.now(),sessionId:'debug-session',runId:'detail-perf',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;
  const meetingId = req.params.id;

  // Try to find as artifact first - support both UUID and readableId
  // #region agent log
  const artifactQueryStart = Date.now();
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/detail.js:artifact_query_start',message:'Starting artifact query',data:{meetingId},timestamp:Date.now(),sessionId:'debug-session',runId:'detail-perf',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  // First, check if user has access via ownership or sharing
  let hasAccess = false;
  let isOwner = false;
  let shareInfo = null;
  
  // Try to find the artifact first (without user filter to check sharing)
  let artifact = await db.MeetingArtifact.findOne({
    where: {
      [Op.or]: [
        { id: meetingId },
        { readableId: meetingId },
      ],
    },
    include: [
      {
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      },
      {
        model: db.MeetingSummary,
      },
      {
        model: db.MeetingTranscriptChunk,
        order: [["sequence", "ASC"]],
        // Limit chunks to avoid loading thousands at once - we can load more on demand if needed
        limit: 1000,
      },
    ],
  });
  
  if (artifact) {
    // Check if user owns this meeting
    isOwner = artifact.userId === userId || artifact.ownerUserId === userId;
    
    if (isOwner) {
      hasAccess = true;
    } else {
      // Check if user has shared access
      const user = await db.User.findByPk(userId);
      const shareWhereClause = {
        meetingArtifactId: artifact.id,
        status: "accepted",
        [Op.or]: [{ sharedWithUserId: userId }],
      };
      if (user?.email) {
        shareWhereClause[Op.or].push({ sharedWithEmail: user.email.toLowerCase() });
      }
      
      shareInfo = await db.MeetingShare.findOne({
        where: shareWhereClause,
        include: [{ model: db.User, as: "sharedByUser", attributes: ["id", "name", "email"] }],
      });
      
      if (shareInfo) {
        hasAccess = true;
      }
    }
    
    if (!hasAccess) {
      // User doesn't have access to this meeting
      artifact = null;
    }
  }
  // #region agent log
  const artifactQueryEnd = Date.now();
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/detail.js:artifact_query_end',message:'Artifact query completed',data:{meetingId,queryTimeMs:artifactQueryEnd-artifactQueryStart,hasArtifact:!!artifact,chunkCount:artifact?.MeetingTranscriptChunks?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'detail-perf',hypothesisId:'B'})}).catch(()=>{});
  // #endregion

  let summary = null;
  let transcriptChunks = [];
  let calendarEvent = null;
  let superAgentAnalysis = null;

  if (artifact) {
    summary = artifact.MeetingSummaries?.[0] || null;
    transcriptChunks = artifact.MeetingTranscriptChunks || [];
    calendarEvent = artifact.CalendarEvent;
    superAgentAnalysis = await db.MeetingSuperAgentAnalysis.findOne({
      where: { meetingArtifactId: artifact.id },
      order: [["createdAt", "DESC"]],
    });
  } else {
    // Try to find as summary
    summary = await db.MeetingSummary.findOne({
      where: { id: meetingId, userId },
      include: [
        {
          model: db.MeetingArtifact,
          include: [
            { 
              model: db.MeetingTranscriptChunk,
              limit: 1000, // Limit chunks to avoid loading thousands at once
            },
          ],
        },
        {
          model: db.CalendarEvent,
          include: [{ model: db.Calendar }],
        },
      ],
    });

    if (!summary) {
      return res.render("404.ejs", { notice: req.notice });
    }

    artifact = summary.MeetingArtifact;
    transcriptChunks = artifact?.MeetingTranscriptChunks || [];
    calendarEvent = summary.CalendarEvent;
    if (artifact?.id) {
      superAgentAnalysis = await db.MeetingSuperAgentAnalysis.findOne({
        where: { meetingArtifactId: artifact.id },
        order: [["createdAt", "DESC"]],
      });
    }
  }

  // Build transcript from chunks or rawPayload
  let transcriptData = transcriptChunks.map(chunk => ({
    id: chunk.id,
    speaker: chunk.speaker || "Unknown",
    text: chunk.text,
    startTimeMs: chunk.startTimeMs,
    endTimeMs: chunk.endTimeMs,
  }));
  
  // If no transcript chunks, try to parse from rawPayload (for API-synced artifacts)
  if (transcriptData.length === 0 && artifact?.rawPayload?.data?.transcript) {
    const rawTranscript = artifact.rawPayload.data.transcript;
    if (Array.isArray(rawTranscript)) {
      transcriptData = rawTranscript.map((item, index) => ({
        id: `raw-${index}`,
        speaker: item.speaker || item.speaker_name || "Unknown",
        text: Array.isArray(item.words) 
          ? item.words.map(w => w.text || w.word || w).join(' ')
          : (item.text || item.transcript || ''),
        startTimeMs: item.start_time || item.start_ms || item.start || 0,
        endTimeMs: item.end_time || item.end_ms || item.end || 0,
      }));
    }
  }

  const derivedStats = computeStatsFromTranscript(transcriptData);

  // Build meeting data
  const meeting = {
    id: artifact?.id || summary?.id,
    readableId: artifact?.readableId || null,
    title: calendarEvent?.title || artifact?.rawPayload?.data?.title || "Untitled Meeting",
    startTime: calendarEvent?.startTime || artifact?.rawPayload?.data?.start_time || artifact?.createdAt || summary?.createdAt,
    endTime: calendarEvent?.endTime || artifact?.rawPayload?.data?.end_time || null,
    status: artifact?.status || summary?.status || "completed",
    participants: artifact?.rawPayload?.data?.participants || artifact?.rawPayload?.data?.attendees || [],
    calendarEmail: calendarEvent?.Calendar?.email || null,
    platform: calendarEvent?.platform || null,
    
    // Recording URLs - check multiple locations including media_shortcuts and archived recordings
    // Prioritize archived recordings, then cached URLs, then source URLs
    videoUrl: 
      artifact?.archivedRecordingUrl ||
      artifact?.rawPayload?.data?.video_url || 
      artifact?.rawPayload?.data?.recording_url || 
    artifact?.rawPayload?.data?.media_shortcuts?.video_mixed?.data?.download_url ||
      artifact?.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
      artifact?.sourceRecordingUrl ||
      null,
    audioUrl: 
      artifact?.rawPayload?.data?.audio_url || 
    artifact?.rawPayload?.data?.media_shortcuts?.audio_mixed?.data?.download_url ||
      artifact?.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url ||
      null,
    teamsRecordingUrl:
      artifact?.rawPayload?.data?.teamsRecordingUrl ||
      artifact?.rawPayload?.data?.teams_video_url ||
      artifact?.rawPayload?.teamsRecordingUrl ||
      artifact?.rawPayload?.data?.sharePointRecordingUrl ||
      null,
    
    // Summary data
    summary: summary?.summary || null,
    actionItems: summary?.actionItems || [],
    followUps: summary?.followUps || [],
    topics: summary?.topics || [],
    highlights: summary?.highlights || [],
    detailedNotes: summary?.detailedNotes || [],
    
    // Sentiment and insights
    // Handle sentiment as object {label, score, confidence} or string
    sentiment: summary?.sentiment 
      ? (typeof summary.sentiment === 'string' 
          ? summary.sentiment 
          : (summary.sentiment.label || summary.sentiment.sentiment || 'neutral'))
      : null,
    sentimentData: summary?.sentiment && typeof summary.sentiment === 'object' ? summary.sentiment : null,
    keyInsights: summary?.keyInsights || [],
    decisions: summary?.decisions || [],
    outcome: summary?.outcome || null,
    stats: summary?.stats || derivedStats || null,
    summarySource: summary?.source || null,

    superAgentAnalysis: superAgentAnalysis
      ? {
          id: superAgentAnalysis.id,
          status: superAgentAnalysis.status,
          requestedFeatures: superAgentAnalysis.requestedFeatures || {},
          detailedSummary: superAgentAnalysis.detailedSummary || null,
          actionItems: superAgentAnalysis.actionItems || [],
          decisions: superAgentAnalysis.decisions || [],
          highlights: superAgentAnalysis.highlights || [],
          chapters: superAgentAnalysis.chapters || [],
          sentiment: superAgentAnalysis.sentiment || null,
          topics: superAgentAnalysis.topics || null,
          contentSafety: superAgentAnalysis.contentSafety || null,
          translation: superAgentAnalysis.translation || null,
          errorMessage: superAgentAnalysis.errorMessage || null,
          createdAt: superAgentAnalysis.createdAt,
          updatedAt: superAgentAnalysis.updatedAt,
        }
      : null,
    superAgentEnabled: process.env.SUPER_AGENT_ENABLED === "true",
    
    // Transcript
    transcript: transcriptData,
    
    // Metadata
    createdAt: artifact?.createdAt || summary?.createdAt,
    rawPayload: artifact?.rawPayload || null,
    
    // For enrichment trigger
    artifactId: artifact?.id || null,
    hasBeenEnriched: !!summary,
    
    // Ownership and sharing
    isOwner,
    isShared: !!shareInfo,
    shareInfo: shareInfo ? {
      accessLevel: shareInfo.accessLevel,
      sharedBy: shareInfo.sharedByUser ? {
        name: shareInfo.sharedByUser.name,
        email: shareInfo.sharedByUser.email,
      } : null,
      sharedAt: shareInfo.createdAt,
    } : null,
  };

  // Get publish deliveries for this meeting
  // #region agent log
  const publishQueryStart = Date.now();
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/detail.js:publish_query_start',message:'Starting publish deliveries query',data:{hasSummary:!!summary,summaryId:summary?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'detail-perf',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  const publishDeliveries = summary ? await db.PublishDelivery.findAll({
    where: { meetingSummaryId: summary.id },
    include: [{ model: db.PublishTarget }],
    order: [["createdAt", "DESC"]],
  }) : [];
  // #region agent log
  const publishQueryEnd = Date.now();
  const totalTime = Date.now() - detailStartTime;
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/detail.js:publish_query_end',message:'Publish query completed and page ready',data:{publishQueryTimeMs:publishQueryEnd-publishQueryStart,totalTimeMs:totalTime,deliveryCount:publishDeliveries.length},timestamp:Date.now(),sessionId:'debug-session',runId:'detail-perf',hypothesisId:'C'})}).catch(()=>{});
  // #endregion

  return res.render("meeting-detail.ejs", {
    notice: req.notice,
    user: req.authentication.user,
    meeting,
    publishDeliveries,
  });
};


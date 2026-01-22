import db from "../../db.js";
import { Op } from "sequelize";

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
  let artifact = await db.MeetingArtifact.findOne({
    where: {
      userId,
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
  // #region agent log
  const artifactQueryEnd = Date.now();
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/detail.js:artifact_query_end',message:'Artifact query completed',data:{meetingId,queryTimeMs:artifactQueryEnd-artifactQueryStart,hasArtifact:!!artifact,chunkCount:artifact?.MeetingTranscriptChunks?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'detail-perf',hypothesisId:'B'})}).catch(()=>{});
  // #endregion

  let summary = null;
  let transcriptChunks = [];
  let calendarEvent = null;

  if (artifact) {
    summary = artifact.MeetingSummaries?.[0] || null;
    transcriptChunks = artifact.MeetingTranscriptChunks || [];
    calendarEvent = artifact.CalendarEvent;
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
    
    // Recording URLs - check multiple locations including media_shortcuts
    videoUrl: 
      artifact?.rawPayload?.data?.video_url || 
      artifact?.rawPayload?.data?.recording_url || 
      artifact?.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
      null,
    audioUrl: 
      artifact?.rawPayload?.data?.audio_url || 
      artifact?.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url ||
      null,
    
    // Summary data
    summary: summary?.summary || null,
    actionItems: summary?.actionItems || [],
    followUps: summary?.followUps || [],
    topics: summary?.topics || [],
    
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
    summarySource: summary?.source || null,
    
    // Transcript
    transcript: transcriptData,
    
    // Metadata
    createdAt: artifact?.createdAt || summary?.createdAt,
    rawPayload: artifact?.rawPayload || null,
    
    // For enrichment trigger
    artifactId: artifact?.id || null,
    hasBeenEnriched: !!summary,
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


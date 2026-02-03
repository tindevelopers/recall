import db from "../../db.js";
import { Op } from "sequelize";

// Generic/placeholder titles we should ignore when deriving a display name
function isGenericMeetingTitle(title) {
  if (!title) return true;
  const normalized = String(title).trim().toLowerCase();
  return (
    normalized === "meeting" ||
    normalized === "untitled meeting" ||
    normalized === "untitled" ||
    normalized === "(no title)"
  );
}

/**
 * Get participants from artifact rawPayload
 */
function getParticipantsFromArtifact(artifact) {
  const data = artifact?.rawPayload?.data || {};
  const participants = data.participants || data.attendees || [];
  if (!Array.isArray(participants)) return [];
  return participants
    .map((p) => {
      if (!p) return null;
      return {
        email: p.email || p.address || p.user_email || p.userId || null,
        name: p.name || p.displayName || p.user_display_name || p.user_name || p.email || null,
      };
    })
    .filter(Boolean);
}

/**
 * Derive a human-readable meeting title from various sources.
 */
function extractMeetingTitle(artifact, calendarEvent) {
  // 1) Calendar event title (from recallData)
  const calEventTitle = calendarEvent?.recallData?.meeting_title || calendarEvent?.recallData?.title || calendarEvent?.title;
  if (calEventTitle && !isGenericMeetingTitle(calEventTitle)) {
    return calEventTitle;
  }

  // 2) Artifact payload title
  if (artifact?.rawPayload?.data?.title && !isGenericMeetingTitle(artifact.rawPayload.data.title)) {
    return artifact.rawPayload.data.title;
  }

  // 3) Bot meeting_metadata title (if present)
  const botMetaTitle = artifact?.rawPayload?.data?.bot_metadata?.meeting_metadata?.title;
  if (botMetaTitle && !isGenericMeetingTitle(botMetaTitle)) {
    return botMetaTitle;
  }

  // 4) Build from participants
  const participants = getParticipantsFromArtifact(artifact);
  if (participants.length > 0) {
    const names = participants
      .slice(0, 2)
      .map((p) => p.name || p.email?.split("@")[0])
      .filter(Boolean);
    if (names.length > 0) {
      return `Meeting with ${names.join(" and ")}${participants.length > 2 ? ` +${participants.length - 2}` : ""}`;
    }
  }

  // 5) Date-based fallback
  const startTime = calendarEvent?.startTime || artifact?.rawPayload?.data?.start_time || artifact?.createdAt;
  if (startTime) {
    const date = new Date(startTime);
    return `Meeting on ${date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })}`;
  }

  return "Untitled Meeting";
}

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;
  const meetingId = req.params.id;

  // FAST INITIAL LOAD: Only fetch minimal metadata, no transcript chunks
  // Artifacts will be lazy-loaded via JavaScript after page renders
  
  let hasAccess = false;
  let isOwner = false;
  let shareInfo = null;
  
  // Find artifact WITHOUT transcript chunks for fast initial load
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
      // NO MeetingTranscriptChunk - this is what makes it slow!
    ],
  });
  
  if (artifact) {
    isOwner = artifact.userId === userId || artifact.ownerUserId === userId;
    
    if (isOwner) {
      hasAccess = true;
    } else {
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
      artifact = null;
    }
  }

  let summary = null;
  let calendarEvent = null;
  let superAgentAnalysis = null;

  if (artifact) {
    summary = artifact.MeetingSummaries?.[0] || null;
    calendarEvent = artifact.CalendarEvent;
    try {
      superAgentAnalysis = await db.MeetingSuperAgentAnalysis.findOne({
        where: { meetingArtifactId: artifact.id },
        order: [["createdAt", "DESC"]],
      });
    } catch (err) {
      console.warn("[meetings/detail] MeetingSuperAgentAnalysis lookup failed:", err?.message || err);
      superAgentAnalysis = null;
    }
  } else {
    // Try to find as summary
    summary = await db.MeetingSummary.findOne({
      where: { id: meetingId, userId },
      include: [
        {
          model: db.MeetingArtifact,
          required: false,
          // NO MeetingTranscriptChunk here either
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
    calendarEvent = summary.CalendarEvent;
    if (artifact?.id) {
      try {
        superAgentAnalysis = await db.MeetingSuperAgentAnalysis.findOne({
          where: { meetingArtifactId: artifact.id },
          order: [["createdAt", "DESC"]],
        });
      } catch (err) {
        console.warn("[meetings/detail] MeetingSuperAgentAnalysis lookup failed:", err?.message || err);
        superAgentAnalysis = null;
      }
    }
  }

  // Get transcript chunk count (fast query, no data transfer)
  let transcriptChunkCount = 0;
  if (artifact?.id) {
    transcriptChunkCount = await db.MeetingTranscriptChunk.count({
      where: { meetingArtifactId: artifact.id },
    });
  }

  // Build meeting data - MINIMAL for fast initial render
  // Heavy data (transcript, stats) will be lazy-loaded
  const meeting = {
    id: artifact?.id || summary?.id,
    readableId: artifact?.readableId || null,
    title: extractMeetingTitle(artifact, calendarEvent),
    startTime: calendarEvent?.startTime || artifact?.rawPayload?.data?.start_time || artifact?.createdAt || summary?.createdAt,
    endTime: calendarEvent?.endTime || artifact?.rawPayload?.data?.end_time || null,
    status: artifact?.status || summary?.status || "completed",
    participants: artifact?.rawPayload?.data?.participants || artifact?.rawPayload?.data?.attendees || [],
    calendarEmail: calendarEvent?.Calendar?.email || null,
    platform: calendarEvent?.platform || null,
    
    // Recording URLs
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
    
    // Summary data - include if available (usually small)
    summary: summary?.summary || null,
    actionItems: summary?.actionItems || [],
    followUps: summary?.followUps || [],
    topics: summary?.topics || [],
    highlights: summary?.highlights || [],
    detailedNotes: summary?.detailedNotes || [],
    
    // Sentiment and insights
    sentiment: summary?.sentiment 
      ? (typeof summary.sentiment === 'string' 
          ? summary.sentiment 
          : (summary.sentiment.label || summary.sentiment.sentiment || 'neutral'))
      : null,
    sentimentData: summary?.sentiment && typeof summary.sentiment === 'object' ? summary.sentiment : null,
    keyInsights: summary?.keyInsights || [],
    decisions: summary?.decisions || [],
    outcome: summary?.outcome || null,
    stats: summary?.stats || null, // Stats will be computed from transcript when lazy-loaded
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
    
    // LAZY LOADING: Transcript will be fetched via API
    transcript: [], // Empty - will be lazy-loaded
    transcriptChunkCount, // Tell the UI how many chunks to expect
    lazyLoadTranscript: transcriptChunkCount > 0, // Flag to trigger lazy loading
    
    // Metadata
    createdAt: artifact?.createdAt || summary?.createdAt,
    rawPayload: null, // Don't send raw payload to client - it's huge
    
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
  let publishDeliveries = [];
  try {
    if (summary) {
      publishDeliveries = await db.PublishDelivery.findAll({
        where: { meetingSummaryId: summary.id },
        include: [{ model: db.PublishTarget }],
        order: [["createdAt", "DESC"]],
      });
    }
  } catch (err) {
    console.warn("[meetings/detail] PublishDelivery lookup failed:", err?.message || err);
  }

  return res.render("meeting-detail.ejs", {
    notice: req.notice,
    user: req.authentication.user,
    meeting,
    publishDeliveries,
  });
};


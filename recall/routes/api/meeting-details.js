import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { findAccessibleArtifact } from "../../services/meetings/access.js";
import { isSuperAgentEnabled } from "../../utils/super-agent.js";
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

/**
 * Get meeting metadata (fast, no transcript) for lazy loading
 * GET /api/meetings/:meetingId/metadata
 */
export async function getMeetingMetadata(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;
  const userEmail = req.authentication.user.email || null;

  try {
    // Find artifact with minimal includes (no transcript chunks)
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
      ],
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Check access
    const isOwner = artifact.userId === userId || artifact.ownerUserId === userId;
    let hasAccess = isOwner;
    let shareInfo = null;

    if (!isOwner) {
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
      return res.status(403).json({ error: "Access denied" });
    }

    const calendarEvent = artifact.CalendarEvent;
    const summary = artifact.MeetingSummaries?.[0] || null;

    // Get super agent analysis status
    let superAgentAnalysis = null;
    try {
      superAgentAnalysis = await db.MeetingSuperAgentAnalysis.findOne({
        where: { meetingArtifactId: artifact.id },
        order: [["createdAt", "DESC"]],
        attributes: ["id", "status", "createdAt", "updatedAt"],
      });
    } catch (err) {
      console.warn("[API] MeetingSuperAgentAnalysis lookup failed:", err?.message);
    }

    // Get transcript chunk count (fast query)
    const transcriptCount = await db.MeetingTranscriptChunk.count({
      where: { meetingArtifactId: artifact.id },
    });

    // Build metadata response
    const metadata = {
      id: artifact.id,
      readableId: artifact.readableId,
      title: extractMeetingTitle(artifact, calendarEvent),
      startTime: calendarEvent?.startTime || artifact?.rawPayload?.data?.start_time || artifact?.createdAt,
      endTime: calendarEvent?.endTime || artifact?.rawPayload?.data?.end_time || null,
      status: artifact.status || "completed",
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
      
      // Flags for lazy loading
      hasSummary: !!summary,
      hasTranscript: transcriptCount > 0,
      transcriptChunkCount: transcriptCount,
      superAgentStatus: superAgentAnalysis?.status || null,
      superAgentEnabled: isSuperAgentEnabled(calendarEvent?.Calendar),
      
      // Ownership
      isOwner,
      isShared: !!shareInfo,
      
      // For enrichment
      artifactId: artifact.id,
      hasBeenEnriched: !!summary,
      
      createdAt: artifact.createdAt,
    };

    return res.json({ metadata });
  } catch (error) {
    console.error(`[API] Error fetching metadata for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to fetch meeting metadata" });
  }
}

function normalizeRequestedFeatures(features = {}) {
  if (!features || typeof features !== "object") return {};

  const normalized = {
    translateTo: Array.isArray(features.translateTo)
      ? features.translateTo.filter((lang) => typeof lang === "string" && lang.trim())
      : [],
    topicDetection: !!features.topicDetection,
    contentModeration: !!features.contentModeration,
    piiRedaction: !!features.piiRedaction,
    profanityFiltering: !!features.profanityFiltering,
    sentimentAnalysis: !!features.sentimentAnalysis,
  };

  if (normalized.translateTo.length === 0) {
    delete normalized.translateTo;
  }

  return normalized;
}

/**
 * Get transcript for a meeting
 * GET /api/meetings/:meetingId/transcript
 */
export async function getTranscript(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;
  const userEmail = req.authentication.user.email || null;

  try {
    // Find the meeting artifact (id or readableId) with access (owner, creator, or accepted share)
    const artifact = await findAccessibleArtifact({
      meetingIdOrReadableId: meetingId,
      userId,
      userEmail,
    });

    if (!artifact) {
      console.log(`[API] Transcript: Meeting ${meetingId} not accessible for user ${userId}`);
      return res.status(404).json({ error: "Meeting not found" });
    }

    console.log(`[API] Transcript: Found artifact ${artifact.id}, recallBotId: ${artifact.recallBotId}`);
    console.log(`[API] Transcript: rawPayload keys:`, Object.keys(artifact.rawPayload || {}));
    console.log(`[API] Transcript: rawPayload.data keys:`, Object.keys(artifact.rawPayload?.data || {}));
    console.log(`[API] Transcript: Has transcript in rawPayload:`, !!artifact.rawPayload?.data?.transcript);
    if (artifact.rawPayload?.data?.transcript) {
      console.log(`[API] Transcript: transcript type:`, typeof artifact.rawPayload.data.transcript);
      console.log(`[API] Transcript: transcript keys:`, Object.keys(artifact.rawPayload.data.transcript));
      console.log(`[API] Transcript: words count:`, artifact.rawPayload?.data?.transcript?.words?.length);
    }

    // Get transcript chunks for this artifact
    const transcriptChunks = await db.MeetingTranscriptChunk.findAll({
      where: { meetingArtifactId: artifact.id },
      order: [["sequence", "ASC"]],
    });

    console.log(`[API] Transcript: Found ${transcriptChunks.length} transcript chunks in DB`);

    // Format transcript data
    let transcript = transcriptChunks.map(chunk => ({
      speaker: chunk.speaker || "Speaker",
      text: chunk.text,
      timestamp: chunk.startTimeMs,
      isFinal: true,
    }));

    // If no transcript chunks in DB, try to get from rawPayload
    if (transcript.length === 0 && artifact.rawPayload?.data?.transcript) {
      const rawTranscript = artifact.rawPayload.data.transcript;
      console.log(`[API] Transcript: rawPayload.data.transcript type:`, typeof rawTranscript);
      
      // Handle different transcript formats from Recall API
      if (Array.isArray(rawTranscript) && rawTranscript.length > 0) {
        // Check the first element to determine format
        const firstItem = rawTranscript[0];
        console.log(`[API] Transcript: First item keys:`, Object.keys(firstItem || {}));
        console.log(`[API] Transcript: First item sample:`, JSON.stringify(firstItem).substring(0, 300));
        
        // Recall.ai format: array of segments with participant and words
        // Each segment: { participant: { id, name }, words: [{ word, start_timestamp, end_timestamp }] }
        if (firstItem.participant && firstItem.words) {
          console.log(`[API] Transcript: Using Recall.ai segment format (${rawTranscript.length} segments)`);
          transcript = rawTranscript.flatMap((segment, segIdx) => {
            const speakerName = segment.participant?.name || `Speaker ${segment.participant?.id || segIdx}`;
            // Combine words into sentences for better readability
            if (Array.isArray(segment.words) && segment.words.length > 0) {
              // Group words into sentences (by pause or punctuation)
              const text = segment.words.map(w => w.word || w.text || '').join(' ').trim();
              const startTime = segment.words[0]?.start_timestamp || 0;
              return [{
                speaker: speakerName,
                text: text,
                timestamp: startTime,
                isFinal: true,
              }];
            }
            return [];
          });
        } else {
          // Direct array format - each item is a transcript segment
          console.log(`[API] Transcript: Using direct array format (${rawTranscript.length} segments)`);
          transcript = rawTranscript.map((segment, idx) => ({
            speaker: segment.speaker || segment.speaker_id || segment.participant?.name || "Speaker",
            text: segment.text || segment.word || segment.transcript || "",
            timestamp: segment.start_timestamp || segment.start_time || segment.timestamp || 0,
            isFinal: true,
          }));
        }
      } else if (rawTranscript.words && Array.isArray(rawTranscript.words)) {
        // Object with words array format
        console.log(`[API] Transcript: Using words array format (${rawTranscript.words.length} words)`);
        transcript = rawTranscript.words.map(word => ({
          speaker: word.speaker || word.speaker_id || "Speaker",
          text: word.word || word.text || "",
          timestamp: word.start_timestamp || word.start_time || 0,
          isFinal: true,
        }));
      } else if (rawTranscript.results && Array.isArray(rawTranscript.results)) {
        // Object with results array format
        console.log(`[API] Transcript: Using results array format (${rawTranscript.results.length} results)`);
        transcript = rawTranscript.results.map(result => ({
          speaker: result.speaker || result.speaker_id || "Speaker",
          text: result.text || result.transcript || "",
          timestamp: result.start_timestamp || result.start_time || 0,
          isFinal: true,
        }));
      } else {
        console.log(`[API] Transcript: Unknown format, transcript not parsed`);
      }
    }

    console.log(`[API] Transcript: Returning ${transcript.length} transcript entries`);
    return res.json({ transcript });
  } catch (error) {
    console.error(`[API] Error fetching transcript for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to fetch transcript" });
  }
}

/**
 * Get AI summary for a meeting
 * GET /api/meetings/:meetingId/summary
 */
export async function getSummary(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;
  const userEmail = req.authentication.user.email || null;

  try {
    const artifact = await findAccessibleArtifact({
      meetingIdOrReadableId: meetingId,
      userId,
      userEmail,
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Get summary for this artifact
    const summary = await db.MeetingSummary.findOne({
      where: { meetingArtifactId: artifact.id },
      order: [["createdAt", "DESC"]],
    });

    if (!summary) {
      return res.json({ summary: null });
    }


    // Use the correct field names from the model
    return res.json({ 
      summary: {
        content: summary.summary || "",
        keyTopics: summary.topics || [],
        actionItems: summary.actionItems || [],
        followUps: summary.followUps || [],
        highlights: summary.highlights || [],
        detailedNotes: summary.detailedNotes || [],
        stats: summary.stats || null,
        sentiment: summary.sentiment || null,
        keyInsights: summary.keyInsights || [],
        decisions: summary.decisions || [],
        outcome: summary.outcome || null,
        source: summary.source || null,
      }
    });
  } catch (error) {
    console.error(`[API] Error fetching summary for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to fetch summary" });
  }
}

/**
 * Get action items for a meeting
 * GET /api/meetings/:meetingId/actions
 */
export async function getActionItems(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;
  const userEmail = req.authentication.user.email || null;

  try {
    const artifact = await findAccessibleArtifact({
      meetingIdOrReadableId: meetingId,
      userId,
      userEmail,
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Get summary for this artifact (action items are typically in the summary)
    const summary = await db.MeetingSummary.findOne({
      where: { meetingArtifactId: artifact.id },
      order: [["createdAt", "DESC"]],
    });

    // Use the actionItems field directly from the model
    const actionItems = summary?.actionItems || [];
    

    return res.json({ actionItems });
  } catch (error) {
    console.error(`[API] Error fetching action items for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to fetch action items" });
  }
}

/**
 * Trigger on-demand enrichment for a meeting
 * POST /api/meetings/enrich
 */
export async function triggerEnrichment(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { artifactId } = req.body;
  const userId = req.authentication.user.id;
  const userEmail = req.authentication.user.email || null;

  if (!artifactId) {
    return res.status(400).json({ error: "artifactId is required" });
  }

  try {
    // Find the meeting artifact (id or readableId) with access
    const artifact = await findAccessibleArtifact({
      meetingIdOrReadableId: artifactId,
      userId,
      userEmail,
    });

    if (!artifact) {
      console.log(`[API] Enrich: Artifact ${artifactId} not accessible for user ${userId}`);
      return res.status(404).json({ error: "Meeting artifact not found" });
    }

    console.log(`[API] Enrich: Queueing enrichment for artifact ${artifact.id}`);

    // Queue the enrichment job
    await backgroundQueue.add(
      "meeting.enrich",
      {
        meetingArtifactId: artifact.id,
        userId,
        source: "on_demand",
      },
      {
        jobId: `enrich-${artifact.id}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    console.log(`[API] Enrich: Successfully queued enrichment for artifact ${artifact.id}`);

    return res.json({
      success: true,
      message: "Enrichment job queued successfully",
      artifactId: artifact.id,
    });
  } catch (error) {
    console.error(`[API] Error triggering enrichment for artifact ${artifactId}:`, error);
    return res.status(500).json({ error: "Failed to trigger enrichment" });
  }
}

/**
 * Trigger Super Agent analysis (AssemblyAI premium)
 * POST /api/meetings/:meetingId/super-agent/analyze
 */
export async function triggerSuperAgentAnalysis(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!process.env.ASSEMBLYAI_API_KEY) {
    return res.status(503).json({ error: "AssemblyAI is not configured" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;
  const userEmail = req.authentication.user.email || null;

  try {
    const accessibleArtifact = await findAccessibleArtifact({
      meetingIdOrReadableId: meetingId,
      userId,
      userEmail,
    });

    if (!accessibleArtifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const artifact = await db.MeetingArtifact.findByPk(accessibleArtifact.id, {
      include: [
        { model: db.CalendarEvent, include: [{ model: db.Calendar }] },
      ],
    });
    if (!artifact) {
      return res.status(404).json({ error: "Meeting artifact not found" });
    }
    if (!isSuperAgentEnabled(artifact.CalendarEvent?.Calendar)) {
      return res.status(403).json({ error: "Super Agent is not enabled for this account" });
    }
    const requestedFeatures = normalizeRequestedFeatures(req.body?.features || {});

    const analysis = await db.MeetingSuperAgentAnalysis.create({
      meetingArtifactId: artifact.id,
      userId,
      status: "queued",
      requestedFeatures,
    });

    await backgroundQueue.add(
      "meeting.super_agent.start",
      {
        analysisId: analysis.id,
        meetingArtifactId: artifact.id,
        userId,
        requestedFeatures,
      },
      {
        jobId: `super-agent-start-${analysis.id}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    return res.json({
      success: true,
      analysisId: analysis.id,
      status: analysis.status,
    });
  } catch (error) {
    console.error(`[API] Super Agent analyze error for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to trigger Super Agent analysis" });
  }
}

/**
 * Get Super Agent analysis status/results
 * GET /api/meetings/:meetingId/super-agent
 */
export async function getSuperAgentAnalysis(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;
  const userEmail = req.authentication.user.email || null;

  try {
    const accessibleArtifact = await findAccessibleArtifact({
      meetingIdOrReadableId: meetingId,
      userId,
      userEmail,
    });

    if (!accessibleArtifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const analysis = await db.MeetingSuperAgentAnalysis.findOne({
      where: { meetingArtifactId: accessibleArtifact.id },
      order: [["createdAt", "DESC"]],
    });

    if (!analysis) {
      return res.json({ analysis: null });
    }

    return res.json({
      analysis: {
        id: analysis.id,
        status: analysis.status,
        requestedFeatures: analysis.requestedFeatures || {},
        detailedSummary: analysis.detailedSummary || null,
        actionItems: analysis.actionItems || [],
        decisions: analysis.decisions || [],
        highlights: analysis.highlights || [],
        chapters: analysis.chapters || [],
        sentiment: analysis.sentiment || null,
        topics: analysis.topics || [],
        contentSafety: analysis.contentSafety || null,
        translation: analysis.translation || null,
        errorMessage: analysis.errorMessage || null,
        createdAt: analysis.createdAt,
        updatedAt: analysis.updatedAt,
      },
    });
  } catch (error) {
    console.error(`[API] Error fetching Super Agent analysis for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to fetch Super Agent analysis" });
  }
}

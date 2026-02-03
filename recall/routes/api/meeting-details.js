import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { findAccessibleArtifact } from "../../services/meetings/access.js";

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

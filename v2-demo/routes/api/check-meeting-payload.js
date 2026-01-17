/**
 * Diagnostic endpoint to check meeting artifact payloads for recording and transcription data.
 *
 * GET /api/check-meeting-payload?recallEventId=<id>
 * GET /api/check-meeting-payload?recallBotId=<id>
 * GET /api/check-meeting-payload?artifactId=<id>
 */

import db from "../../db.js";

export default async (req, res) => {
  const { recallEventId, recallBotId, artifactId } = req.query;

  if (!recallEventId && !recallBotId && !artifactId) {
    return res.status(400).json({
      error: "Missing query parameter",
      usage: "GET /api/check-meeting-payload?recallEventId=<id> OR ?recallBotId=<id> OR ?artifactId=<id>",
    });
  }

  try {
    let artifact = null;
    
    if (artifactId) {
      artifact = await db.MeetingArtifact.findByPk(artifactId);
    } else if (recallEventId) {
      artifact = await db.MeetingArtifact.findOne({
        where: { recallEventId },
        order: [["createdAt", "DESC"]],
      });
    } else if (recallBotId) {
      artifact = await db.MeetingArtifact.findOne({
        where: { recallBotId },
        order: [["createdAt", "DESC"]],
      });
    }

    if (!artifact) {
      return res.status(404).json({
        error: "Meeting artifact not found",
        searchedBy: { recallEventId, recallBotId, artifactId },
      });
    }

    const payload = artifact.rawPayload || {};
    const data = payload.data || payload;

    // Check for recording data
    const hasRecording = !!(
      data?.video_url ||
      data?.recording_url ||
      data?.videoUrl ||
      data?.recordingUrl ||
      payload?.video_url ||
      payload?.recording_url
    );

    const recordingData = {
      video_url: data?.video_url || data?.videoUrl || payload?.video_url || null,
      recording_url: data?.recording_url || data?.recordingUrl || payload?.recording_url || null,
      audio_url: data?.audio_url || data?.audioUrl || payload?.audio_url || null,
    };

    // Check for transcription data
    const hasTranscript = !!(
      data?.transcript?.segments ||
      data?.transcript_segments ||
      data?.segments ||
      data?.words ||
      payload?.transcript?.segments ||
      payload?.transcript_segments
    );

    const transcriptData = {
      hasSegments: !!(data?.transcript?.segments || data?.transcript_segments || data?.segments),
      hasWords: !!data?.words,
      segmentCount: (data?.transcript?.segments || data?.transcript_segments || data?.segments || []).length,
      wordCount: (data?.words || []).length,
    };

    // Get transcript chunks from database
    const transcriptChunks = await db.MeetingTranscriptChunk.findAll({
      where: { meetingArtifactId: artifact.id },
      order: [["sequence", "ASC"]],
    });

    return res.json({
      artifact: {
        id: artifact.id,
        recallEventId: artifact.recallEventId,
        recallBotId: artifact.recallBotId,
        eventType: artifact.eventType,
        status: artifact.status,
        createdAt: artifact.createdAt,
      },
      payload: {
        hasRecording,
        hasTranscript,
        recording: recordingData,
        transcript: transcriptData,
        transcriptChunksCount: transcriptChunks.length,
        payloadKeys: Object.keys(payload),
        dataKeys: data ? Object.keys(data) : [],
      },
      fullPayload: payload, // Include full payload for inspection
      transcriptChunks: transcriptChunks.slice(0, 10), // First 10 chunks as sample
    });
  } catch (error) {
    console.error("[CHECK-MEETING-PAYLOAD] Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
};

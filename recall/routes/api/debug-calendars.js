import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = req.authentication.user.id;
  
  // If artifactId is provided, return full artifact details including rawPayload transcript structure
  const { artifactId } = req.query;
  if (artifactId) {
    const artifact = await db.MeetingArtifact.findOne({
      where: { id: artifactId, userId },
      include: [{ model: db.MeetingTranscriptChunk, limit: 10 }],
    });
    
    if (!artifact) {
      return res.status(404).json({ error: "Artifact not found" });
    }
    
    const rawPayload = artifact.rawPayload || {};
    const data = rawPayload?.data || {};
    
    // Extract transcript structure for debugging
    const transcriptDebug = {
      hasTranscriptKey: 'transcript' in data,
      transcriptType: typeof data.transcript,
      transcriptIsArray: Array.isArray(data.transcript),
      transcriptKeys: data.transcript && typeof data.transcript === 'object' && !Array.isArray(data.transcript) 
        ? Object.keys(data.transcript) 
        : null,
      transcriptLength: Array.isArray(data.transcript) ? data.transcript.length : null,
      transcriptSample: Array.isArray(data.transcript) 
        ? data.transcript.slice(0, 3) 
        : (data.transcript?.segments?.slice?.(0, 3) || data.transcript),
      hasSegmentsKey: !!(data.transcript?.segments),
      segmentsLength: data.transcript?.segments?.length,
      hasWordsKey: 'words' in data,
      wordsLength: data.words?.length,
      wordsSample: data.words?.slice?.(0, 5),
    };
    
    return res.json({
      artifact: {
        id: artifact.id,
        recallEventId: artifact.recallEventId,
        recallBotId: artifact.recallBotId,
        eventType: artifact.eventType,
        status: artifact.status,
        createdAt: artifact.createdAt,
      },
      rawPayloadKeys: Object.keys(rawPayload),
      dataKeys: Object.keys(data),
      transcriptDebug,
      transcriptChunks: (artifact.MeetingTranscriptChunks || []).map(c => ({
        id: c.id,
        sequence: c.sequence,
        speaker: c.speaker,
        text: c.text,
        startTimeMs: c.startTimeMs,
        endTimeMs: c.endTimeMs,
      })),
    });
  }

  try {
    // Get calendars directly from database
    const calendars = await db.Calendar.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
    });

    // Get calendars via association
    const calendarsViaAssociation = await req.authentication.user.getCalendars();

    // Get artifacts with transcript chunks
    const artifacts = await db.MeetingArtifact.findAll({
      where: { userId },
      limit: 10,
      order: [["createdAt", "DESC"]],
      include: [
        { model: db.MeetingTranscriptChunk, limit: 5 },
      ],
    });

    // Get transcript chunk counts
    const transcriptChunkCounts = await db.MeetingTranscriptChunk.findAll({
      where: { userId },
      attributes: [
        'meetingArtifactId',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']
      ],
      group: ['meetingArtifactId'],
    });

    return res.json({
      userId,
      calendarsDirect: calendars.map(c => ({
        id: c.id,
        platform: c.platform,
        recallId: c.recallId,
        recallData: c.recallData,
        status: c.status,
        email: c.email,
        createdAt: c.createdAt,
      })),
      calendarsViaAssociation: calendarsViaAssociation.map(c => ({
        id: c.id,
        platform: c.platform,
        recallId: c.recallId,
        recallData: c.recallData,
        status: c.status,
        email: c.email,
        createdAt: c.createdAt,
      })),
      calendarsCount: calendars.length,
      calendarsViaAssociationCount: calendarsViaAssociation.length,
      artifacts: artifacts.map(a => ({
        id: a.id,
        recallEventId: a.recallEventId,
        recallBotId: a.recallBotId,
        eventType: a.eventType,
        status: a.status,
        hasRawPayload: !!a.rawPayload,
        rawPayloadKeys: a.rawPayload ? Object.keys(a.rawPayload) : [],
        rawPayloadDataKeys: a.rawPayload?.data ? Object.keys(a.rawPayload.data) : [],
        hasTranscriptInPayload: !!(
          a.rawPayload?.data?.transcript ||
          a.rawPayload?.data?.transcript?.segments ||
          a.rawPayload?.data?.transcript_segments ||
          a.rawPayload?.transcript?.segments
        ),
        transcriptChunksCount: a.MeetingTranscriptChunks?.length || 0,
        transcriptChunksSample: (a.MeetingTranscriptChunks || []).slice(0, 2).map(c => ({
          id: c.id,
          speaker: c.speaker,
          textPreview: c.text?.substring(0, 50),
        })),
        createdAt: a.createdAt,
      })),
      artifactsCount: artifacts.length,
      transcriptChunkCounts: transcriptChunkCounts.map(c => ({
        meetingArtifactId: c.meetingArtifactId,
        count: c.get('count'),
      })),
    });
  } catch (error) {
    console.error("Debug error:", error);
    return res.status(500).json({ 
      error: "Failed to debug", 
      message: error.message,
      stack: error.stack,
    });
  }
};

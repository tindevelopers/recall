import db from "../../db.js";

export default async (req, res) => {
  const { botId } = req.query;
  
  if (!botId) {
    return res.status(400).json({ error: "botId query parameter is required" });
  }
  
  try {
    // Find meeting artifacts for this bot
    const artifacts = await db.MeetingArtifact.findAll({
      where: { recallBotId: botId },
      order: [["createdAt", "DESC"]],
      limit: 20,
    });
    
    if (artifacts.length === 0) {
      return res.json({
        botId,
        found: false,
        message: "No meeting artifacts found for this bot",
        notetakerInvoked: false,
      });
    }
    
    // Check if notetaker was invoked (has transcript segments)
    const results = artifacts.map(artifact => {
      const payload = artifact.rawPayload || {};
      const data = payload.data || payload;
      
      const hasTranscript = !!(
        data?.transcript?.segments ||
        data?.transcript_segments ||
        data?.segments ||
        payload?.transcript?.segments ||
        payload?.transcript_segments
      );
      
      const segments = hasTranscript ? (
        data?.transcript?.segments || 
        data?.transcript_segments ||
        data?.segments ||
        payload?.transcript?.segments ||
        payload?.transcript_segments || []
      ) : [];
      
      return {
        artifactId: artifact.id,
        recallEventId: artifact.recallEventId,
        eventType: artifact.eventType,
        status: artifact.status,
        createdAt: artifact.createdAt,
        notetakerInvoked: hasTranscript,
        transcriptSegmentsCount: segments.length,
        hasTranscript: hasTranscript,
      };
    });
    
    const notetakerInvoked = results.some(r => r.notetakerInvoked);
    
    return res.json({
      botId,
      found: true,
      notetakerInvoked,
      totalArtifacts: artifacts.length,
      artifactsWithTranscript: results.filter(r => r.notetakerInvoked).length,
      artifacts: results,
    });
    
  } catch (error) {
    console.error("Error checking bot:", error);
    return res.status(500).json({ 
      error: "Failed to check bot", 
      message: error.message 
    });
  }
};

/**
 * Refresh recording URLs for a meeting artifact by re-fetching bot data from Recall API.
 * 
 * POST /api/meetings/:meetingId/refresh-recording
 */

import db from "../../db.js";
import Recall from "../../services/recall/index.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;

  try {
    // Find the meeting artifact
    const artifact = await db.MeetingArtifact.findOne({
      where: { id: meetingId, userId },
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    if (!artifact.recallBotId) {
      return res.status(400).json({ error: "Meeting has no associated bot" });
    }

    console.log(`[REFRESH-RECORDING] Fetching bot data for ${artifact.recallBotId}`);

    // Fetch bot data from Recall API
    const botData = await Recall.getBot(artifact.recallBotId);
    
    if (!botData) {
      return res.status(404).json({ error: "Bot not found in Recall API" });
    }

    console.log(`[REFRESH-RECORDING] Bot status: ${botData.status?.code}, recordings: ${botData.recordings?.length || 0}`);

    // Extract video and audio URLs from media_shortcuts
    let videoUrl = null;
    let audioUrl = null;
    
    if (botData.recordings && botData.recordings.length > 0) {
      const shortcuts = botData.recordings[0].media_shortcuts;
      if (shortcuts) {
        videoUrl = shortcuts.video?.data?.download_url || null;
        audioUrl = shortcuts.audio?.data?.download_url || null;
        console.log(`[REFRESH-RECORDING] Found URLs: video=${videoUrl ? 'present' : 'N/A'}, audio=${audioUrl ? 'present' : 'N/A'}`);
      }
    }

    if (!videoUrl && !audioUrl) {
      return res.json({
        success: false,
        message: "No recording URLs found in bot data",
        botStatus: botData.status?.code,
        recordingsCount: botData.recordings?.length || 0,
      });
    }

    // Update the artifact's rawPayload with the recording URLs
    const updatedPayload = {
      ...artifact.rawPayload,
      data: {
        ...artifact.rawPayload?.data,
        video_url: videoUrl,
        audio_url: audioUrl,
        recording_url: videoUrl,
        bot: botData,
        recordings: botData.recordings,
        media_shortcuts: botData.recordings?.[0]?.media_shortcuts,
      },
    };

    await artifact.update({ rawPayload: updatedPayload });

    console.log(`[REFRESH-RECORDING] Updated artifact ${artifact.id} with recording URLs`);

    return res.json({
      success: true,
      message: "Recording URLs refreshed successfully",
      hasVideo: !!videoUrl,
      hasAudio: !!audioUrl,
    });
  } catch (error) {
    console.error(`[REFRESH-RECORDING] Error:`, error);
    return res.status(500).json({ 
      error: "Failed to refresh recording",
      message: error.message,
    });
  }
};


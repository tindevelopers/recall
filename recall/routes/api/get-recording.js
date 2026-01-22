/**
 * Get recording URLs for a meeting artifact.
 * If URLs are not cached, fetches from Recall API and updates the artifact.
 * 
 * GET /api/meetings/:meetingId/recording
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

    // Check if we already have recording URLs cached
    const cachedVideoUrl = artifact.rawPayload?.data?.video_url ||
                           artifact.rawPayload?.data?.recording_url ||
                           artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url;
    const cachedAudioUrl = artifact.rawPayload?.data?.audio_url ||
                           artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url;

    if (cachedVideoUrl || cachedAudioUrl) {
      return res.json({
        videoUrl: cachedVideoUrl || null,
        audioUrl: cachedAudioUrl || null,
        cached: true,
      });
    }

    // No cached URLs - try to fetch from Recall API if we have a bot ID
    if (!artifact.recallBotId) {
      return res.json({
        videoUrl: null,
        audioUrl: null,
        message: "No recording available - meeting has no associated bot",
      });
    }

    console.log(`[GET-RECORDING] Fetching bot data for ${artifact.recallBotId}`);

    // Fetch bot data from Recall API
    let botData;
    try {
      botData = await Recall.getBot(artifact.recallBotId);
    } catch (apiError) {
      console.error(`[GET-RECORDING] Recall API error:`, apiError.message);
      return res.json({
        videoUrl: null,
        audioUrl: null,
        message: "Could not fetch recording from Recall API",
      });
    }
    
    if (!botData) {
      return res.json({
        videoUrl: null,
        audioUrl: null,
        message: "Bot not found in Recall API",
      });
    }

    console.log(`[GET-RECORDING] Bot status: ${botData.status?.code}, recordings: ${botData.recordings?.length || 0}`);

    // Extract video and audio URLs from media_shortcuts
    let videoUrl = null;
    let audioUrl = null;
    
    if (botData.recordings && botData.recordings.length > 0) {
      const shortcuts = botData.recordings[0].media_shortcuts;
      if (shortcuts) {
        videoUrl = shortcuts.video?.data?.download_url || null;
        audioUrl = shortcuts.audio?.data?.download_url || null;
        console.log(`[GET-RECORDING] Found URLs: video=${videoUrl ? 'present' : 'N/A'}, audio=${audioUrl ? 'present' : 'N/A'}`);
      }
    }

    if (!videoUrl && !audioUrl) {
      return res.json({
        videoUrl: null,
        audioUrl: null,
        message: "No recording URLs found in bot data",
        botStatus: botData.status?.code,
      });
    }

    // Update the artifact's rawPayload with the recording URLs for caching
    const updatedPayload = {
      ...artifact.rawPayload,
      data: {
        ...artifact.rawPayload?.data,
        video_url: videoUrl,
        audio_url: audioUrl,
        recording_url: videoUrl,
        recordings: botData.recordings,
        media_shortcuts: botData.recordings?.[0]?.media_shortcuts,
      },
    };

    await artifact.update({ rawPayload: updatedPayload });
    console.log(`[GET-RECORDING] Updated artifact ${artifact.id} with recording URLs`);

    return res.json({
      videoUrl,
      audioUrl,
      cached: false,
    });
  } catch (error) {
    console.error(`[GET-RECORDING] Error:`, error);
    return res.status(500).json({ 
      error: "Failed to get recording",
      message: error.message,
    });
  }
};


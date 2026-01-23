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
      include: [{ model: db.CalendarEvent, include: [{ model: db.Calendar }] }],
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Check if we already have recording URLs cached (prioritize Recall recordings)
    const cachedVideoUrl = artifact.rawPayload?.data?.video_url ||
                           artifact.rawPayload?.data?.recording_url ||
                           artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url;
    const cachedAudioUrl = artifact.rawPayload?.data?.audio_url ||
                           artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url;
    
    // Check for Teams recording URLs
    // Teams recordings are stored in OneDrive/SharePoint, NOT the meeting join URL
    // The meeting join URL (teams.microsoft.com/l/meetup-join/...) opens the meeting lobby, not the recording
    let teamsVideoUrl = artifact.rawPayload?.data?.teamsRecordingUrl ||
                        artifact.rawPayload?.data?.teams_video_url ||
                        artifact.rawPayload?.teamsRecordingUrl;
    
    // Check for SharePoint/OneDrive recording URL (the actual recording location)
    if (!teamsVideoUrl && artifact.rawPayload?.data?.sharePointRecordingUrl) {
      teamsVideoUrl = artifact.rawPayload.data.sharePointRecordingUrl;
    }
    
    // NOTE: We intentionally do NOT fall back to the meeting join URL
    // The join URL (teams.microsoft.com/l/meetup-join/...) opens the meeting lobby,
    // not the recording. Users would see "Join your Teams meeting" instead of the video.

    // If we have Recall video, return it (prioritize Recall)
    if (cachedVideoUrl || cachedAudioUrl) {
      return res.json({
        videoUrl: cachedVideoUrl || null,
        audioUrl: cachedAudioUrl || null,
        teamsVideoUrl: teamsVideoUrl || null,
        source: 'recall',
        cached: true,
      });
    }
    
    // If no Recall recording but we have Teams recording, return it
    if (teamsVideoUrl) {
      return res.json({
        videoUrl: null,
        audioUrl: null,
        teamsVideoUrl: teamsVideoUrl,
        source: 'teams',
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

    // Refresh Teams recording URL after updating payload (reuse existing variable from above)
    // Only use actual recording URLs, not meeting join URLs
    teamsVideoUrl = artifact.rawPayload?.data?.teamsRecordingUrl ||
                    artifact.rawPayload?.data?.teams_video_url ||
                    artifact.rawPayload?.teamsRecordingUrl ||
                    artifact.rawPayload?.data?.sharePointRecordingUrl ||
                    teamsVideoUrl;

    return res.json({
      videoUrl,
      audioUrl,
      teamsVideoUrl: teamsVideoUrl || null,
      source: videoUrl || audioUrl ? 'recall' : (teamsVideoUrl ? 'teams' : null),
      cached: false,
    });
  } catch (error) {
    console.error(`[GET-RECORDING] Error:`, error);
    
    // Even on error, check if we have Teams recording URL (actual recording, not join URL)
    try {
      const artifact = await db.MeetingArtifact.findOne({
        where: { id: meetingId, userId },
        include: [{ model: db.CalendarEvent }],
      });
      const teamsVideoUrl = artifact?.rawPayload?.data?.teamsRecordingUrl ||
                            artifact?.rawPayload?.data?.teams_video_url ||
                            artifact?.rawPayload?.teamsRecordingUrl ||
                            artifact?.rawPayload?.data?.sharePointRecordingUrl;
      
      // NOTE: We do NOT fall back to meeting join URL - it doesn't show recordings
      
      if (teamsVideoUrl) {
        return res.json({
          videoUrl: null,
          audioUrl: null,
          teamsVideoUrl: teamsVideoUrl,
          source: 'teams',
          cached: true,
        });
      }
    } catch (fallbackError) {
      // Ignore fallback error
    }
    
    return res.status(500).json({ 
      error: "Failed to get recording",
      message: error.message,
    });
  }
};


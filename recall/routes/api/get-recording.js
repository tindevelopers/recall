/**
 * Get recording URLs for a meeting artifact.
 * If URLs are not cached, fetches from Recall API and updates the artifact.
 *
 * GET /api/meetings/:meetingId/recording
 */

import db from "../../db.js";
import Recall from "../../services/recall/index.js";
import { Op } from "sequelize";

const resolveSourceUrl = (artifact) =>
  artifact.archivedRecordingUrl ||
  artifact.sourceRecordingUrl ||
  artifact.rawPayload?.data?.video_url ||
  artifact.rawPayload?.data?.recording_url ||
  artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
  artifact.rawPayload?.media_shortcuts?.video?.data?.download_url ||
  artifact.rawPayload?.recording_url ||
  null;

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;

  try {
    // Find the meeting artifact (owner or creator)
    const artifact = await db.MeetingArtifact.findOne({
      where: {
        id: meetingId,
        [Op.or]: [{ userId }, { ownerUserId: userId }],
      },
      include: [{ model: db.CalendarEvent, include: [{ model: db.Calendar }] }],
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const calendar = artifact.CalendarEvent?.Calendar;
    const canArchive = !!(calendar?.storageProvider && calendar?.storageBucket);

    // Cached Recall URLs
    const cachedVideoUrl =
      artifact.rawPayload?.data?.video_url ||
      artifact.rawPayload?.data?.recording_url ||
      artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url;
    const cachedAudioUrl =
      artifact.rawPayload?.data?.audio_url ||
      artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url;

    const archivedUrl = artifact.archivedRecordingUrl || null;
    const sourceUrl = resolveSourceUrl(artifact);
    const proxyUrl = sourceUrl ? `/api/meetings/${artifact.id}/recording/stream` : null;

    // Teams/SharePoint URLs if present in payload
    const teamsVideoUrl =
      artifact.rawPayload?.data?.teamsRecordingUrl ||
      artifact.rawPayload?.data?.teams_video_url ||
      artifact.rawPayload?.teamsRecordingUrl ||
      artifact.rawPayload?.data?.sharePointRecordingUrl ||
      null;

    // If we have Recall video cached, return it (prioritize Recall)
    if (cachedVideoUrl || cachedAudioUrl) {
      return res.json({
        videoUrl: cachedVideoUrl || null,
        audioUrl: cachedAudioUrl || null,
        teamsVideoUrl: teamsVideoUrl || null,
        archivedUrl,
        sourceUrl,
        proxyUrl,
        source: "recall",
        cached: true,
        isArchived: !!archivedUrl,
        archiveStatus: archivedUrl ? "completed" : null,
        canArchive,
      });
    }

    // If no Recall recording but we have source/Teams recording, return it
    if (teamsVideoUrl || sourceUrl) {
      return res.json({
        videoUrl: null,
        audioUrl: null,
        teamsVideoUrl: teamsVideoUrl || sourceUrl,
        archivedUrl,
        sourceUrl,
        proxyUrl,
        source: teamsVideoUrl ? "teams" : "external",
        cached: true,
        isArchived: !!archivedUrl,
        archiveStatus: archivedUrl ? "completed" : null,
        canArchive,
      });
    }

    // No cached URLs - try to fetch from Recall API if we have a bot ID
    if (!artifact.recallBotId) {
      return res.json({
        videoUrl: null,
        audioUrl: null,
        archivedUrl,
        sourceUrl,
        proxyUrl,
        isArchived: !!archivedUrl,
        archiveStatus: archivedUrl ? "completed" : null,
        canArchive,
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
        archivedUrl,
        sourceUrl,
        proxyUrl,
        isArchived: !!archivedUrl,
        archiveStatus: archivedUrl ? "completed" : null,
        canArchive,
        message: "Could not fetch recording from Recall API",
      });
    }

    if (!botData) {
      return res.json({
        videoUrl: null,
        audioUrl: null,
        archivedUrl,
        sourceUrl,
        proxyUrl,
        isArchived: !!archivedUrl,
        archiveStatus: archivedUrl ? "completed" : null,
        canArchive,
        message: "Bot not found in Recall API",
      });
    }

    console.log(
      `[GET-RECORDING] Bot status: ${botData.status?.code}, recordings: ${
        botData.recordings?.length || 0
      }`
    );

    // Extract video and audio URLs from media_shortcuts
    let videoUrl = null;
    let audioUrl = null;

    if (botData.recordings && botData.recordings.length > 0) {
      const shortcuts = botData.recordings[0].media_shortcuts;
      if (shortcuts) {
        videoUrl = shortcuts.video?.data?.download_url || null;
        audioUrl = shortcuts.audio?.data?.download_url || null;
        console.log(
          `[GET-RECORDING] Found URLs: video=${videoUrl ? "present" : "N/A"}, audio=${
            audioUrl ? "present" : "N/A"
          }`
        );
      }
    }

    if (!videoUrl && !audioUrl) {
      return res.json({
        videoUrl: null,
        audioUrl: null,
        archivedUrl,
        sourceUrl,
        proxyUrl,
        isArchived: !!archivedUrl,
        archiveStatus: archivedUrl ? "completed" : null,
        canArchive,
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

    await artifact.update({
      rawPayload: updatedPayload,
      sourceRecordingUrl: artifact.sourceRecordingUrl || videoUrl || audioUrl || sourceUrl,
    });
    console.log(`[GET-RECORDING] Updated artifact ${artifact.id} with recording URLs`);

    const refreshedSourceUrl = resolveSourceUrl(artifact) || sourceUrl;

    return res.json({
      videoUrl,
      audioUrl,
      teamsVideoUrl: teamsVideoUrl || null,
      sourceUrl: refreshedSourceUrl,
      proxyUrl: refreshedSourceUrl ? `/api/meetings/${artifact.id}/recording/stream` : null,
      archivedUrl,
      source: videoUrl || audioUrl ? "recall" : teamsVideoUrl ? "teams" : null,
      cached: false,
      isArchived: !!archivedUrl,
      archiveStatus: archivedUrl ? "completed" : null,
      canArchive,
    });
  } catch (error) {
    console.error(`[GET-RECORDING] Error:`, error);

    // Even on error, check if we have Teams/source recording URL
    try {
      const artifact = await db.MeetingArtifact.findOne({
        where: {
          id: meetingId,
          [Op.or]: [{ userId }, { ownerUserId: userId }],
        },
        include: [{ model: db.CalendarEvent }],
      });
      const teamsVideoUrl =
        artifact?.rawPayload?.data?.teamsRecordingUrl ||
        artifact?.rawPayload?.data?.teams_video_url ||
        artifact?.rawPayload?.teamsRecordingUrl ||
        artifact?.rawPayload?.data?.sharePointRecordingUrl ||
        resolveSourceUrl(artifact);

      if (teamsVideoUrl) {
        return res.json({
          videoUrl: null,
          audioUrl: null,
          teamsVideoUrl,
          sourceUrl: teamsVideoUrl,
          proxyUrl: `/api/meetings/${artifact.id}/recording/stream`,
          archivedUrl: artifact?.archivedRecordingUrl || null,
          isArchived: !!artifact?.archivedRecordingUrl,
          archiveStatus: artifact?.archivedRecordingUrl ? "completed" : null,
          canArchive: !!(
            artifact?.CalendarEvent?.Calendar?.storageProvider &&
            artifact?.CalendarEvent?.Calendar?.storageBucket
          ),
          source: "teams",
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

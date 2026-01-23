/**
 * Get recording URLs for a meeting artifact.
 * If URLs are not cached, fetches from Recall API and updates the artifact.
 *
 * GET /api/meetings/:meetingId/recording
 */

import db from "../../db.js";
import Recall from "../../services/recall/index.js";
import { fetchTeamsRecordingMetadata } from "../../services/microsoft-graph/index.js";
import { Op } from "sequelize";

const resolveSourceUrl = (artifact) =>
  artifact.archivedRecordingUrl ||
  artifact.sourceRecordingUrl ||
  artifact.rawPayload?.data?.video_url ||
  artifact.rawPayload?.data?.recording_url ||
  artifact.rawPayload?.data?.media_shortcuts?.video_mixed?.data?.download_url ||
  artifact.rawPayload?.data?.media_shortcuts?.audio_mixed?.data?.download_url ||
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
    artifact.rawPayload?.data?.media_shortcuts?.video_mixed?.data?.download_url ||
      artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url;
    const cachedAudioUrl =
      artifact.rawPayload?.data?.audio_url ||
    artifact.rawPayload?.data?.media_shortcuts?.audio_mixed?.data?.download_url ||
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

      // Try listing recordings directly via v1 if bot lookup failed
      try {
        const recordingsResp = await Recall.listRecordingsV1({
          botId: artifact.recallBotId,
          statusCode: "done",
        });
        const recordings =
          recordingsResp?.results ||
          recordingsResp?.recordings ||
          recordingsResp ||
          [];
        if (Array.isArray(recordings) && recordings.length > 0) {
          const urls = Recall.getRecordingUrlsFromBot({ recordings });
          if (urls.videoUrl || urls.audioUrl) {
            console.log(
              `[GET-RECORDING] Found recording URLs via listRecordingsV1: video=${urls.videoUrl ? "present" : "N/A"}, audio=${urls.audioUrl ? "present" : "N/A"}`
            );
            await artifact.update({
              sourceRecordingUrl: urls.videoUrl || urls.audioUrl,
              rawPayload: {
                ...artifact.rawPayload,
                data: {
                  ...artifact.rawPayload?.data,
                  video_url: urls.videoUrl,
                  audio_url: urls.audioUrl,
                  recording_url: urls.videoUrl || urls.audioUrl,
                  recordings,
                  media_shortcuts: recordings[0]?.media_shortcuts,
                },
              },
            });

            const updatedSourceUrl =
              resolveSourceUrl(artifact) || urls.videoUrl || urls.audioUrl;
            return res.json({
              videoUrl: urls.videoUrl,
              audioUrl: urls.audioUrl,
              teamsVideoUrl: teamsVideoUrl || null,
              archivedUrl,
              sourceUrl: updatedSourceUrl,
              proxyUrl: updatedSourceUrl
                ? `/api/meetings/${artifact.id}/recording/stream`
                : null,
              source: "recall",
              cached: false,
              isArchived: !!archivedUrl,
              archiveStatus: archivedUrl ? "completed" : null,
              canArchive,
            });
          }
        }
      } catch (listErr) {
        console.log(
          `[GET-RECORDING] listRecordingsV1 fallback failed: ${listErr.message}`
        );
      }
      
      // Try fetching recording URLs from calendar event's bots array
      console.log(`[GET-RECORDING] Attempting to fetch recording from calendar event's bots array...`);
      try {
        const calendarEvent = artifact.CalendarEvent;
        if (calendarEvent && calendarEvent.recallId) {
          const { getClient } = await import("../../services/recall/api-client.js");
          const recallClient = getClient();
          
          // Fetch calendar event from Recall API to get bots array
          const recallEvent = await recallClient.request({
            path: `/api/v2/calendar-events/${calendarEvent.recallId}/`,
            method: "GET",
          });
          
          console.log(`[GET-RECORDING] Fetched calendar event, bots count: ${recallEvent?.bots?.length || 0}`);
          
          if (recallEvent?.bots && Array.isArray(recallEvent.bots) && recallEvent.bots.length > 0) {
            // Check each bot - calendar event bots array only has bot_id, not full bot data
            // Try fetching each bot_id to get full bot data with recordings
            for (const botRef of recallEvent.bots) {
              const botId = botRef.bot_id || botRef.id;
              if (!botId) continue;
              
              console.log(`[GET-RECORDING] Trying to fetch full bot data for ${botId}...`);
              try {
                const fullBot = await Recall.getBot(botId);
                const urls = Recall.getRecordingUrlsFromBot(fullBot);
                
                if (urls.videoUrl || urls.audioUrl) {
                  console.log(`[GET-RECORDING] Found recording URLs in bot ${botId}: video=${urls.videoUrl ? 'present' : 'N/A'}, audio=${urls.audioUrl ? 'present' : 'N/A'}`);
                  
                  // Update artifact with recording URLs
                  await artifact.update({
                    sourceRecordingUrl: urls.videoUrl || urls.audioUrl,
                    rawPayload: {
                      ...artifact.rawPayload,
                      data: {
                        ...artifact.rawPayload?.data,
                        video_url: urls.videoUrl,
                        audio_url: urls.audioUrl,
                        recording_url: urls.videoUrl || urls.audioUrl,
                        recordings: fullBot.recordings,
                        media_shortcuts: fullBot.recordings?.[0]?.media_shortcuts || fullBot.media_shortcuts,
                      },
                    },
                  });
                  
                  const updatedSourceUrl = resolveSourceUrl(artifact) || urls.videoUrl || urls.audioUrl;
                  
                  return res.json({
                    videoUrl: urls.videoUrl,
                    audioUrl: urls.audioUrl,
                    teamsVideoUrl: teamsVideoUrl || null,
                    archivedUrl,
                    sourceUrl: updatedSourceUrl,
                    proxyUrl: updatedSourceUrl ? `/api/meetings/${artifact.id}/recording/stream` : null,
                    source: "recall",
                    cached: false,
                    isArchived: !!archivedUrl,
                    archiveStatus: archivedUrl ? "completed" : null,
                    canArchive,
                  });
                }
              } catch (botFetchError) {
                // Bot might also return 404, continue to next bot
                console.log(`[GET-RECORDING] Bot ${botId} fetch failed: ${botFetchError.message}`);
                continue;
              }
            }
          }
        }
      } catch (calendarEventError) {
        console.error(`[GET-RECORDING] Calendar event fetch error:`, calendarEventError.message);
      }
      
      // Try fetching Teams recording metadata as fallback
      console.log(`[GET-RECORDING] Attempting to fetch Teams recording metadata as fallback...`);
      try {
        const calendarEvent = artifact.CalendarEvent;
        if (calendarEvent && calendarEvent.platform === "microsoft_outlook") {
          const teamsMetadata = await fetchTeamsRecordingMetadata(calendarEvent);
          if (teamsMetadata && teamsMetadata.recordings && teamsMetadata.recordings.length > 0) {
            const firstRecording = teamsMetadata.recordings[0];
            const teamsRecordingUrl = firstRecording.contentDownloadUrl || 
                                     firstRecording.downloadUrl || 
                                     firstRecording.recordingContentUrl ||
                                     null;
            
            if (teamsRecordingUrl) {
              console.log(`[GET-RECORDING] Found Teams recording URL: ${teamsRecordingUrl}`);
              
              // Update artifact with Teams recording URL
              await artifact.update({
                sourceRecordingUrl: teamsRecordingUrl,
                rawPayload: {
                  ...artifact.rawPayload,
                  data: {
                    ...artifact.rawPayload?.data,
                    teamsRecordingUrl: teamsRecordingUrl,
                    teamsRecordingMetadata: teamsMetadata.recordings,
                  },
                },
              });
              
              const updatedSourceUrl = resolveSourceUrl(artifact) || teamsRecordingUrl;
              
              return res.json({
                videoUrl: null,
                audioUrl: null,
                teamsVideoUrl: teamsRecordingUrl,
                archivedUrl,
                sourceUrl: updatedSourceUrl,
                proxyUrl: updatedSourceUrl ? `/api/meetings/${artifact.id}/recording/stream` : null,
                source: "teams",
                cached: false,
                isArchived: !!archivedUrl,
                archiveStatus: archivedUrl ? "completed" : null,
                canArchive,
              });
            }
          }
        }
      } catch (teamsError) {
        console.error(`[GET-RECORDING] Teams recording fetch error:`, teamsError.message);
      }
      
      return res.json({
        videoUrl: null,
        audioUrl: null,
        archivedUrl,
        sourceUrl,
        proxyUrl,
        isArchived: !!archivedUrl,
        archiveStatus: archivedUrl ? "completed" : null,
        canArchive,
        message: "Could not fetch recording from Recall API, calendar event bots, or Teams",
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

    const { videoUrl, audioUrl } = Recall.getRecordingUrlsFromBot(botData);
    console.log(
      `[GET-RECORDING] Found URLs: video=${videoUrl ? "present" : "N/A"}, audio=${
        audioUrl ? "present" : "N/A"
      }`
    );

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

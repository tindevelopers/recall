import fetch from "node-fetch";
import db from "../../db.js";
import { createStorageFromSettings } from "../../services/storage/index.js";
import { Op } from "sequelize";

function resolveSourceUrl(artifact) {
  return (
    artifact.sourceRecordingUrl ||
    artifact.rawPayload?.data?.video_url ||
    artifact.rawPayload?.data?.recording_url ||
    artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
    artifact.rawPayload?.media_shortcuts?.video?.data?.download_url ||
    artifact.rawPayload?.recording_url ||
    null
  );
}

export default async (job) => {
  const { meetingArtifactId } = job.data;
  console.log(`[Recording Archive] Starting for artifact ${meetingArtifactId}`);

  const artifact = await db.MeetingArtifact.findByPk(meetingArtifactId, {
    include: [
      {
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      },
    ],
  });

  if (!artifact) {
    console.warn(`[Recording Archive] Artifact ${meetingArtifactId} not found`);
    return;
  }

  const storage = createStorageFromSettings(artifact.CalendarEvent?.Calendar || {});
  if (!storage) {
    console.warn(`[Recording Archive] No storage configured; skipping archive for ${meetingArtifactId}`);
    return;
  }

  const sourceUrl = resolveSourceUrl(artifact);
  if (!sourceUrl) {
    console.warn(`[Recording Archive] No source recording URL for ${meetingArtifactId}`);
    return;
  }

  try {
    const resp = await fetch(sourceUrl);
    if (!resp.ok || !resp.body) {
      throw new Error(`Failed to fetch source recording (status ${resp.status})`);
    }

    const contentType = resp.headers.get("content-type");
    const contentLength = resp.headers.get("content-length");

    const uploadResult = await storage.uploadRecording(
      artifact.id,
      resp.body,
      {
        contentType,
        size: contentLength ? parseInt(contentLength, 10) : undefined,
        format: contentType,
      }
    );

    await artifact.update({
      archivedRecordingUrl: uploadResult.location,
      archivedAt: new Date(),
      recordingFormat: contentType || artifact.recordingFormat,
      recordingSize: contentLength ? parseInt(contentLength, 10) : artifact.recordingSize,
      sourceRecordingUrl: artifact.sourceRecordingUrl || sourceUrl,
    });

    console.log(`[Recording Archive] Archived recording for ${meetingArtifactId} to ${uploadResult.location}`);
  } catch (error) {
    console.error(`[Recording Archive] Error archiving recording for ${meetingArtifactId}:`, error);
    throw error;
  }
};



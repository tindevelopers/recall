import express from "express";
import fetch from "node-fetch";
import db from "../../db.js";
import { Op } from "sequelize";

const router = express.Router();

async function findArtifact(meetingId, userId) {
  return db.MeetingArtifact.findOne({
    where: {
      id: meetingId,
      [Op.or]: [{ userId }, { ownerUserId: userId }],
    },
    include: [{ model: db.CalendarEvent, include: [{ model: db.Calendar }] }],
  });
}

function resolveSourceUrl(artifact) {
  // Prioritize archived recording (most reliable)
  if (artifact.archivedRecordingUrl) {
    return artifact.archivedRecordingUrl;
  }
  // Then check Recall API URLs
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

function resolveVideoUrl(artifact) {
  // Prioritize archived recording (most reliable)
  if (artifact.archivedRecordingUrl) {
    return artifact.archivedRecordingUrl;
  }
  // Then check Recall API URLs
  return (
    artifact.rawPayload?.data?.video_url ||
    artifact.rawPayload?.data?.recording_url ||
    artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
    artifact.rawPayload?.media_shortcuts?.video?.data?.download_url ||
    artifact.sourceRecordingUrl ||
    null
  );
}

function resolveAudioUrl(artifact) {
  // Note: archived recordings are typically video, but check if audio is archived separately
  // For now, prioritize Recall API audio URLs
  return (
    artifact.rawPayload?.data?.audio_url ||
    artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url ||
    artifact.rawPayload?.media_shortcuts?.audio?.data?.download_url ||
    null
  );
}

// Return best available URL (for download or direct playback)
router.get("/meetings/:meetingId/recording/url", async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;

  const artifact = await findArtifact(meetingId, userId);
  if (!artifact) {
    return res.status(404).json({ error: "Meeting not found" });
  }

  const sourceUrl = resolveSourceUrl(artifact);
  if (!sourceUrl) {
    return res.status(404).json({ error: "No recording URL available" });
  }

  return res.json({
    sourceUrl,
    meetingId: artifact.id,
    platform: artifact.meetingPlatform || artifact.eventType,
  });
});

// Proxy stream to avoid CORS issues
router.get("/meetings/:meetingId/recording/stream", async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;

  const artifact = await findArtifact(meetingId, userId);
  if (!artifact) {
    return res.status(404).json({ error: "Meeting not found" });
  }

  const sourceUrl = resolveSourceUrl(artifact);
  if (!sourceUrl) {
    return res.status(404).json({ error: "No recording URL available" });
  }

  try {
    const upstream = await fetch(sourceUrl);
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({
        error: "Failed to fetch recording from source",
        status: upstream.status,
      });
    }

    // Forward essential headers
    const contentType = upstream.headers.get("content-type");
    const contentLength = upstream.headers.get("content-length");
    if (contentType) res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);

    res.status(200);
    upstream.body.pipe(res);
  } catch (error) {
    console.error(`[Recording Proxy] Error streaming recording for ${meetingId}:`, error);
    res.status(502).json({ error: "Failed to proxy recording" });
  }
});

// Download video recording
router.get("/meetings/:meetingId/recording/download/video", async (req, res) => {
  const { meetingId } = req.params;
  let artifact = null;
  let userId = null;

  // Check if authenticated
  if (req.authenticated) {
    userId = req.authentication.user.id;
    artifact = await findArtifact(meetingId, userId);
  }

  // If not found via auth, try share token
  if (!artifact) {
    const shareToken = req.query.token || req.headers["x-share-token"];
    if (shareToken) {
      const share = await db.MeetingShare.findOne({
        where: {
          shareToken,
          status: { [Op.ne]: "revoked" },
        },
        include: [{ model: db.MeetingArtifact }],
      });

      if (share && share.MeetingArtifact && share.MeetingArtifact.id === meetingId) {
        // Check if share has expired
        if (!share.expiresAt || new Date(share.expiresAt) >= new Date()) {
          artifact = share.MeetingArtifact;
        }
      }
    }
  }

  if (!artifact) {
    return res.status(404).json({ error: "Meeting not found or access denied" });
  }

  const videoUrl = resolveVideoUrl(artifact);
  if (!videoUrl) {
    return res.status(404).json({ error: "No video recording available" });
  }

  try {
    const upstream = await fetch(videoUrl);
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({
        error: "Failed to fetch recording from source",
        status: upstream.status,
      });
    }

    // Get meeting title for filename
    const meetingTitle = (artifact.title || artifact.meetingTitle || "meeting")
      .replace(/[^a-z0-9]/gi, "_")
      .substring(0, 50);
    const filename = `${meetingTitle}_video.mp4`;

    // Set download headers
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const contentType = upstream.headers.get("content-type") || "video/mp4";
    const contentLength = upstream.headers.get("content-length");
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);

    res.status(200);
    upstream.body.pipe(res);
  } catch (error) {
    console.error(`[Recording Download] Error downloading video for ${meetingId}:`, error);
    res.status(502).json({ error: "Failed to download recording" });
  }
});

// Download audio recording
router.get("/meetings/:meetingId/recording/download/audio", async (req, res) => {
  const { meetingId } = req.params;
  let artifact = null;
  let userId = null;

  // Check if authenticated
  if (req.authenticated) {
    userId = req.authentication.user.id;
    artifact = await findArtifact(meetingId, userId);
  }

  // If not found via auth, try share token
  if (!artifact) {
    const shareToken = req.query.token || req.headers["x-share-token"];
    if (shareToken) {
      const share = await db.MeetingShare.findOne({
        where: {
          shareToken,
          status: { [Op.ne]: "revoked" },
        },
        include: [{ model: db.MeetingArtifact }],
      });

      if (share && share.MeetingArtifact && share.MeetingArtifact.id === meetingId) {
        // Check if share has expired
        if (!share.expiresAt || new Date(share.expiresAt) >= new Date()) {
          artifact = share.MeetingArtifact;
        }
      }
    }
  }

  if (!artifact) {
    return res.status(404).json({ error: "Meeting not found or access denied" });
  }

  const audioUrl = resolveAudioUrl(artifact);
  if (!audioUrl) {
    return res.status(404).json({ error: "No audio recording available" });
  }

  try {
    const upstream = await fetch(audioUrl);
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({
        error: "Failed to fetch recording from source",
        status: upstream.status,
      });
    }

    // Get meeting title for filename
    const meetingTitle = (artifact.title || artifact.meetingTitle || "meeting")
      .replace(/[^a-z0-9]/gi, "_")
      .substring(0, 50);
    const filename = `${meetingTitle}_audio.mp3`;

    // Set download headers
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const contentLength = upstream.headers.get("content-length");
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);

    res.status(200);
    upstream.body.pipe(res);
  } catch (error) {
    console.error(`[Recording Download] Error downloading audio for ${meetingId}:`, error);
    res.status(502).json({ error: "Failed to download recording" });
  }
});

// Public download endpoints for shared meetings (via token)
router.get("/meetings/shared/:token/recording/download/video", async (req, res) => {
  const { token } = req.params;

  const share = await db.MeetingShare.findOne({
    where: {
      shareToken: token,
      status: { [Op.ne]: "revoked" },
    },
    include: [{ model: db.MeetingArtifact }],
  });

  if (!share || !share.MeetingArtifact) {
    return res.status(404).json({ error: "Share not found or invalid" });
  }

  // Check if share has expired
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Share expired" });
  }

  const artifact = share.MeetingArtifact;
  const videoUrl = resolveVideoUrl(artifact);
  if (!videoUrl) {
    return res.status(404).json({ error: "No video recording available" });
  }

  try {
    const upstream = await fetch(videoUrl);
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({
        error: "Failed to fetch recording from source",
        status: upstream.status,
      });
    }

    const meetingTitle = (artifact.title || artifact.meetingTitle || "meeting")
      .replace(/[^a-z0-9]/gi, "_")
      .substring(0, 50);
    const filename = `${meetingTitle}_video.mp4`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const contentType = upstream.headers.get("content-type") || "video/mp4";
    const contentLength = upstream.headers.get("content-length");
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);

    res.status(200);
    upstream.body.pipe(res);
  } catch (error) {
    console.error(`[Recording Download] Error downloading video for shared meeting ${token}:`, error);
    res.status(502).json({ error: "Failed to download recording" });
  }
});

router.get("/meetings/shared/:token/recording/download/audio", async (req, res) => {
  const { token } = req.params;

  const share = await db.MeetingShare.findOne({
    where: {
      shareToken: token,
      status: { [Op.ne]: "revoked" },
    },
    include: [{ model: db.MeetingArtifact }],
  });

  if (!share || !share.MeetingArtifact) {
    return res.status(404).json({ error: "Share not found or invalid" });
  }

  // Check if share has expired
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Share expired" });
  }

  const artifact = share.MeetingArtifact;
  const audioUrl = resolveAudioUrl(artifact);
  if (!audioUrl) {
    return res.status(404).json({ error: "No audio recording available" });
  }

  try {
    const upstream = await fetch(audioUrl);
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({
        error: "Failed to fetch recording from source",
        status: upstream.status,
      });
    }

    const meetingTitle = (artifact.title || artifact.meetingTitle || "meeting")
      .replace(/[^a-z0-9]/gi, "_")
      .substring(0, 50);
    const filename = `${meetingTitle}_audio.mp3`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const contentLength = upstream.headers.get("content-length");
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);

    res.status(200);
    upstream.body.pipe(res);
  } catch (error) {
    console.error(`[Recording Download] Error downloading audio for shared meeting ${token}:`, error);
    res.status(502).json({ error: "Failed to download recording" });
  }
});

export default router;


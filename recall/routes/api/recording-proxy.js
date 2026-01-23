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

export default router;


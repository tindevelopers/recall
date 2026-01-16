import { backgroundQueue } from "../../queue.js";
import db from "../../db.js";
import { v4 as uuidv4 } from "uuid";

const DEBUG_ENDPOINT =
  "http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc";
const logDebug = (payload) => {
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
};

function extractRecallIdentifiers(payload) {
  const data = payload?.data || payload;
  return {
    recallEventId:
      data?.calendar_event_id ||
      data?.event_id ||
      data?.meeting_id ||
      data?.id ||
      null,
    recallBotId: data?.bot_id || data?.botId || null,
  };
}

function extractTranscriptSegments(payload) {
  const data = payload?.data || payload;
  const segments =
    data?.transcript?.segments ||
    data?.segments ||
    data?.transcript_segments ||
    [];
  if (!Array.isArray(segments)) {
    return [];
  }
  return segments
    .filter((s) => s?.text)
    .map((s, idx) => ({
      sequence: idx,
      startTimeMs:
        s?.startTimeMs ??
        s?.start_ms ??
        (typeof s?.start === "number" ? s.start * 1000 : null),
      endTimeMs:
        s?.endTimeMs ??
        s?.end_ms ??
        (typeof s?.end === "number" ? s.end * 1000 : null),
      speaker: s?.speaker || s?.speaker_id || s?.participant || null,
      text: s.text,
    }));
}

export default async (req, res) => {
  const { event, data } = req.body || {};
  const rawPayload = req.body || {};
  const { recallEventId, recallBotId } = extractRecallIdentifiers(rawPayload);

  // #region agent log
  logDebug({
    sessionId: "debug-session",
    runId: "pre-fix",
    hypothesisId: "H4",
    location: "recall-notes.js:21",
    message: "Received Recall notes webhook",
    data: {
      event,
      recallEventId,
      recallBotId,
      hasTranscript: !!(
        rawPayload?.data?.transcript?.segments ||
        rawPayload?.data?.transcript_segments ||
        rawPayload?.data?.segments
      ),
    },
    timestamp: Date.now(),
  });
  // #endregion

  console.log(`[INFO] Received Recall notes webhook: event=${event}, recallEventId=${recallEventId}, recallBotId=${recallBotId}`);
  console.log(`[INFO] Payload keys: ${Object.keys(rawPayload).join(', ')}`);
  
  // Log transcript presence
  const hasTranscript = !!(
    rawPayload?.data?.transcript?.segments ||
    rawPayload?.data?.transcript_segments ||
    rawPayload?.data?.segments ||
    rawPayload?.transcript?.segments
  );
  console.log(`[INFO] Has transcript: ${hasTranscript}`);

  try {
    let calendarEvent = null;
    if (recallEventId) {
      calendarEvent = await db.CalendarEvent.findOne({
        where: { recallId: recallEventId },
        include: [{ model: db.Calendar }],
      });
    }

    const artifactDefaults = {
      id: uuidv4(),
      recallEventId,
      recallBotId,
      calendarEventId: calendarEvent?.id || null,
      userId: calendarEvent?.Calendar?.userId || calendarEvent?.userId || null,
      eventType: event || rawPayload?.type || null,
      status: "received",
      rawPayload, // Store entire payload to preserve all metadata
    };

    let artifact = null;
    if (recallEventId) {
      artifact = await db.MeetingArtifact.findOne({
        where: { recallEventId },
      });
    }

    if (artifact) {
      // Merge payloads to preserve all data
      const mergedPayload = {
        ...artifact.rawPayload,
        ...rawPayload,
        // Preserve nested data structures
        data: {
          ...artifact.rawPayload?.data,
          ...rawPayload?.data,
        },
      };
      await artifact.update({
        ...artifactDefaults,
        rawPayload: mergedPayload,
      });
      console.log(`[INFO] Updated existing artifact ${artifact.id}`);
    } else {
      artifact = await db.MeetingArtifact.create(artifactDefaults);
      console.log(`[INFO] Created new artifact ${artifact.id}`);
    }

    // Normalize transcript segments for downstream RAG and enrichment
    const segments = extractTranscriptSegments(rawPayload);
    if (segments.length > 0) {
      await db.MeetingTranscriptChunk.destroy({
        where: { meetingArtifactId: artifact.id },
      });

      const chunksToCreate = segments.map((segment) => ({
        ...segment,
        id: uuidv4(),
        meetingArtifactId: artifact.id,
        userId: artifact.userId,
        calendarEventId: artifact.calendarEventId,
      }));
      await db.MeetingTranscriptChunk.bulkCreate(chunksToCreate, {
        validate: true,
      });
    // #region agent log
    logDebug({
      sessionId: "debug-session",
      runId: "pre-fix",
      hypothesisId: "H5",
      location: "recall-notes.js:112",
      message: "Transcript segments persisted",
      data: {
        artifactId: artifact.id,
        segmentCount: segments.length,
      },
      timestamp: Date.now(),
    });
    // #endregion
    }

    // Enqueue enrichment (LLM summarization, action items, follow-ups)
    backgroundQueue.add("meeting.enrich", {
      meetingArtifactId: artifact.id,
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error("[ERROR] Failed to handle Recall notes webhook:", err);
    return res.sendStatus(500);
  }
};



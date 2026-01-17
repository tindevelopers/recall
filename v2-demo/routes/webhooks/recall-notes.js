import { backgroundQueue } from "../../queue.js";
import db from "../../db.js";
import { v4 as uuidv4 } from "uuid";
import Recall from "../../services/recall/index.js";

/**
 * Webhook handler for Recall.ai transcript and bot events.
 *
 * Events we handle:
 *   - transcript.partial_data: Streaming partial transcript (may be revised)
 *   - transcript.data: Final transcript segment(s)
 *   - transcript.done: Transcription completed
 *   - transcript.failed: Transcription failed
 *   - recording.done: Recording finished (good fallback trigger)
 *   - bot.status_change: Bot lifecycle events
 *   - (legacy) notes: Recall Notepad summary/action items
 */

function extractRecallIdentifiers(payload) {
  const data = payload?.data || payload;
  return {
    recallEventId:
      data?.calendar_event_id ||
      data?.event_id ||
      data?.meeting_id ||
      data?.id ||
      null,
    recallBotId: data?.bot_id || data?.botId || payload?.bot_id || null,
  };
}

/**
 * Extract transcript segments from various payload shapes.
 * Recall streaming events typically have: data.words[] or data.transcript.segments[]
 */
function extractTranscriptSegments(payload, eventType) {
  const data = payload?.data || payload;

  // Streaming events often use `words` array with { text, start_time, end_time, speaker }
  if (Array.isArray(data?.words) && data.words.length > 0) {
    // Combine words into a single segment for this chunk
    const words = data.words;
    const text = words.map((w) => w.text || w.word || "").join(" ");
    const startTimeMs =
      words[0]?.start_time != null ? words[0].start_time * 1000 : null;
    const endTimeMs =
      words[words.length - 1]?.end_time != null
        ? words[words.length - 1].end_time * 1000
        : null;
    const speaker = words[0]?.speaker || data?.speaker || null;
    return [{ text, startTimeMs, endTimeMs, speaker, sequence: 0 }];
  }

  // Full transcript segments array
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
        (typeof s?.start === "number" ? s.start * 1000 : null) ??
        (typeof s?.start_time === "number" ? s.start_time * 1000 : null),
      endTimeMs:
        s?.endTimeMs ??
        s?.end_ms ??
        (typeof s?.end === "number" ? s.end * 1000 : null) ??
        (typeof s?.end_time === "number" ? s.end_time * 1000 : null),
      speaker: s?.speaker || s?.speaker_id || s?.participant || null,
      text: s.text,
    }));
}

export default async (req, res) => {
  const rawPayload = req.body || {};
  const event = rawPayload?.event || rawPayload?.type || null;
  const { recallEventId, recallBotId } = extractRecallIdentifiers(rawPayload);

  console.log(
    `[RECALL-NOTES] Received webhook: event=${event}, recallEventId=${recallEventId}, recallBotId=${recallBotId}`
  );
  console.log(`[RECALL-NOTES] Payload keys: ${Object.keys(rawPayload).join(", ")}`);
  
  // Log recording and transcription data presence for debugging
  const data = rawPayload?.data || rawPayload;
  const hasRecording = !!(data?.video_url || data?.recording_url || data?.videoUrl || data?.recordingUrl);
  const hasTranscript = !!(data?.transcript?.segments || data?.transcript_segments || data?.segments || data?.words);
  console.log(`[RECALL-NOTES] Recording data present: ${hasRecording}, Transcript data present: ${hasTranscript}`);
  
  if (hasRecording) {
    console.log(`[RECALL-NOTES] Recording URLs: video=${data?.video_url || data?.videoUrl || 'N/A'}, audio=${data?.audio_url || data?.audioUrl || 'N/A'}`);
  }
  
  if (hasTranscript) {
    const segmentCount = (data?.transcript?.segments || data?.transcript_segments || data?.segments || []).length;
    const wordCount = (data?.words || []).length;
    console.log(`[RECALL-NOTES] Transcript: ${segmentCount} segments, ${wordCount} words`);
  }

  try {
    // Find associated calendar event (if any)
    let calendarEvent = null;
    if (recallEventId) {
      calendarEvent = await db.CalendarEvent.findOne({
        where: { recallId: recallEventId },
        include: [{ model: db.Calendar }],
      });
    }

    // Find or create MeetingArtifact
    let artifact = null;
    if (recallEventId) {
      artifact = await db.MeetingArtifact.findOne({
        where: { recallEventId },
      });
    }

    const artifactDefaults = {
      recallEventId,
      recallBotId,
      calendarEventId: calendarEvent?.id || null,
      userId: calendarEvent?.Calendar?.userId || calendarEvent?.userId || null,
      eventType: event,
      status: "received",
    };

    if (artifact) {
      // Merge payloads to preserve all data across multiple webhook calls
      const mergedPayload = {
        ...artifact.rawPayload,
        ...rawPayload,
        data: {
          ...artifact.rawPayload?.data,
          ...rawPayload?.data,
        },
      };
      await artifact.update({
        ...artifactDefaults,
        rawPayload: mergedPayload,
      });
      console.log(`[RECALL-NOTES] Updated existing artifact ${artifact.id}`);
    } else {
      artifact = await db.MeetingArtifact.create({
        id: uuidv4(),
        ...artifactDefaults,
        rawPayload,
      });
      console.log(`[RECALL-NOTES] Created new artifact ${artifact.id}`);
    }

    // Handle transcript segments (streaming or final)
    const segments = extractTranscriptSegments(rawPayload, event);
    if (segments.length > 0) {
      // For streaming events (partial_data), we APPEND chunks rather than replacing.
      // For final events (transcript.data, transcript.done), we can replace.
      const isFinalTranscript =
        event === "transcript.data" ||
        event === "transcript.done" ||
        event === "notes";

      if (isFinalTranscript) {
        // Replace all chunks with final transcript
        await db.MeetingTranscriptChunk.destroy({
          where: { meetingArtifactId: artifact.id },
        });
        console.log(
          `[RECALL-NOTES] Cleared existing chunks for final transcript (artifact ${artifact.id})`
        );
      }

      // Get current max sequence for this artifact (for appending)
      let maxSequence = 0;
      if (!isFinalTranscript) {
        const lastChunk = await db.MeetingTranscriptChunk.findOne({
          where: { meetingArtifactId: artifact.id },
          order: [["sequence", "DESC"]],
        });
        maxSequence = lastChunk ? lastChunk.sequence + 1 : 0;
      }

      const chunksToCreate = segments.map((segment, idx) => ({
        id: uuidv4(),
        meetingArtifactId: artifact.id,
        userId: artifact.userId,
        calendarEventId: artifact.calendarEventId,
        sequence: isFinalTranscript ? segment.sequence : maxSequence + idx,
        startTimeMs: segment.startTimeMs,
        endTimeMs: segment.endTimeMs,
        speaker: segment.speaker,
        text: segment.text,
      }));

      await db.MeetingTranscriptChunk.bulkCreate(chunksToCreate, {
        validate: true,
      });

      console.log(
        `[RECALL-NOTES] Persisted ${chunksToCreate.length} transcript chunks (artifact ${artifact.id}, event=${event})`
      );
    }

    // On completion events, check if we have transcript chunks.
    // If not, fetch transcript from Recall API as a fallback.
    const isCompletionEvent =
      event === "transcript.done" ||
      event === "recording.done" ||
      event === "notes";

    if (isCompletionEvent && recallBotId) {
      const existingChunks = await db.MeetingTranscriptChunk.count({
        where: { meetingArtifactId: artifact.id },
      });

      if (existingChunks === 0) {
        console.log(
          `[RECALL-NOTES] No transcript chunks found for artifact ${artifact.id}, fetching from Recall API...`
        );
        try {
          const transcriptData = await Recall.getBotTranscript(recallBotId);
          const fallbackSegments = extractTranscriptSegments(
            { data: transcriptData },
            "transcript.data"
          );

          if (fallbackSegments.length > 0) {
            const fallbackChunks = fallbackSegments.map((segment, idx) => ({
              id: uuidv4(),
              meetingArtifactId: artifact.id,
              userId: artifact.userId,
              calendarEventId: artifact.calendarEventId,
              sequence: idx,
              startTimeMs: segment.startTimeMs,
              endTimeMs: segment.endTimeMs,
              speaker: segment.speaker,
              text: segment.text,
            }));

            await db.MeetingTranscriptChunk.bulkCreate(fallbackChunks, {
              validate: true,
            });

            console.log(
              `[RECALL-NOTES] Fallback fetch: persisted ${fallbackChunks.length} transcript chunks from Recall API`
            );
          } else {
            console.log(
              `[RECALL-NOTES] Fallback fetch: Recall API returned no transcript segments`
            );
          }
        } catch (err) {
          console.warn(
            `[RECALL-NOTES] Fallback fetch failed for bot ${recallBotId}: ${err.message}`
          );
        }
      }
    }

    // Enqueue enrichment ONLY on completion events (not on every partial)
    const shouldEnrich =
      event === "transcript.done" ||
      event === "recording.done" ||
      event === "notes" ||
      event === "bot.status_change";

    if (shouldEnrich) {
      console.log(
        `[RECALL-NOTES] Enqueueing enrichment for artifact ${artifact.id} (event=${event})`
      );
      backgroundQueue.add("meeting.enrich", {
        meetingArtifactId: artifact.id,
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[RECALL-NOTES] Failed to handle webhook:", err);
    return res.sendStatus(500);
  }
};

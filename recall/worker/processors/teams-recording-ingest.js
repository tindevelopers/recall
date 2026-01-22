/**
 * Worker processor for ingesting Microsoft Teams recordings and transcripts
 * 
 * This processor:
 * 1. Identifies Teams meetings from calendar events
 * 2. Fetches transcripts/recordings from Microsoft Graph API
 * 3. Stores transcript chunks in the database
 * 4. Triggers enrichment pipeline
 */

import db from "../../db.js";
import { backgroundQueue } from "../../queue.js";
import { fetchTeamsTranscript, parseVTTTranscript } from "../../services/microsoft-graph/index.js";
import { extractMeetingMetadata } from "../../utils/meeting-metadata-extractor.js";

export default async (job) => {
  const { calendarEventId } = job.data;

  console.log(`[Teams Recording] Starting ingestion for calendar event ${calendarEventId}`);

  try {
    // Load calendar event with calendar relationship
    const calendarEvent = await db.CalendarEvent.findByPk(calendarEventId, {
      include: [{ model: db.Calendar }],
    });

    if (!calendarEvent) {
      console.warn(`[Teams Recording] Calendar event ${calendarEventId} not found`);
      return;
    }

    // Only process Microsoft Outlook calendars
    if (calendarEvent.platform !== "microsoft_outlook") {
      console.log(`[Teams Recording] Skipping non-Microsoft calendar event ${calendarEventId}`);
      return;
    }

    // Check if it's a Teams meeting
    const meetingUrl = calendarEvent.meetingUrl;
    if (!meetingUrl || !meetingUrl.includes("teams.microsoft.com")) {
      console.log(`[Teams Recording] Event ${calendarEventId} is not a Teams meeting`);
      return;
    }

    console.log(`[Teams Recording] Detected Teams meeting: ${meetingUrl}`);

  const meetingMetadata = extractMeetingMetadata({
    meetingUrl,
    calendarMeetingUrl: calendarEvent?.meetingUrl,
  });

    // Fetch transcript from Microsoft Graph
    const transcriptData = await fetchTeamsTranscript(calendarEvent);

    if (!transcriptData) {
      console.log(`[Teams Recording] No transcript available for Teams meeting ${calendarEventId}`);
      return;
    }

    console.log(`[Teams Recording] Successfully fetched transcript for ${calendarEventId}`);

    // Parse VTT transcript into chunks
    const transcriptChunks = parseVTTTranscript(transcriptData.content);

    if (transcriptChunks.length === 0) {
      console.warn(`[Teams Recording] No transcript chunks parsed from VTT content`);
      return;
    }

    console.log(`[Teams Recording] Parsed ${transcriptChunks.length} transcript chunks`);

    // Check if meeting artifact already exists
    let meetingArtifact = await db.MeetingArtifact.findOne({
      where: {
        calendarEventId: calendarEvent.id,
        recallEventId: calendarEvent.recallId,
      },
    });

    const userId = calendarEvent.Calendar?.userId || null;

    // Create or update meeting artifact
    const artifactPayload = {
      recallEventId: calendarEvent.recallId,
      calendarEventId: calendarEvent.id,
      userId,
      eventType: "teams_recording",
      status: "received",
    ...meetingMetadata,
      rawPayload: {
        source: "microsoft_teams",
        meetingId: transcriptData.meetingId,
        transcriptId: transcriptData.transcriptId,
        metadata: transcriptData.metadata,
      meetingUrl,
        title: calendarEvent.title,
        startTime: calendarEvent.startTime?.toISOString(),
        endTime: calendarEvent.endTime?.toISOString(),
      },
    };

    if (meetingArtifact) {
      await meetingArtifact.update(artifactPayload);
      console.log(`[Teams Recording] Updated existing artifact ${meetingArtifact.id}`);
    } else {
      meetingArtifact = await db.MeetingArtifact.create(artifactPayload);
      console.log(`[Teams Recording] Created new artifact ${meetingArtifact.id}`);
    }

    // Delete existing transcript chunks for this artifact (in case we're re-processing)
    await db.MeetingTranscriptChunk.destroy({
      where: { meetingArtifactId: meetingArtifact.id },
    });

    // Store transcript chunks
    const chunkPromises = transcriptChunks.map((chunk, index) =>
      db.MeetingTranscriptChunk.create({
        meetingArtifactId: meetingArtifact.id,
        calendarEventId: calendarEvent.id,
        userId,
        sequence: chunk.sequence ?? index,
        startTimeMs: chunk.startTimeMs,
        endTimeMs: chunk.endTimeMs,
        speaker: chunk.speaker,
        text: chunk.text,
      })
    );

    await Promise.all(chunkPromises);
    console.log(`[Teams Recording] Stored ${transcriptChunks.length} transcript chunks`);

    // Update artifact status to "done" (ready for enrichment)
    await meetingArtifact.update({ status: "done" });

    // Trigger enrichment pipeline
    await backgroundQueue.add("meeting.enrich", {
      meetingArtifactId: meetingArtifact.id,
    });

    console.log(`[Teams Recording] Successfully ingested Teams recording for ${calendarEventId} and queued enrichment`);

  } catch (error) {
    console.error(`[Teams Recording] Error ingesting Teams recording for ${calendarEventId}:`, error);
    console.error(`[Teams Recording] Error stack:`, error.stack);
    throw error; // Re-throw to mark job as failed
  }
};


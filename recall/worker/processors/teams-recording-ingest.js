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
import { fetchTeamsTranscript, fetchTeamsRecordingMetadata, parseVTTTranscript } from "../../services/microsoft-graph/index.js";
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

    // Fetch both transcript and recording metadata from Microsoft Graph
    const [transcriptData, recordingMetadata] = await Promise.all([
      fetchTeamsTranscript(calendarEvent).catch(err => {
        console.warn(`[Teams Recording] Error fetching transcript: ${err.message}`);
        return null;
      }),
      fetchTeamsRecordingMetadata(calendarEvent).catch(err => {
        console.warn(`[Teams Recording] Error fetching recording metadata: ${err.message}`);
        return null;
      }),
    ]);

    // If neither transcript nor recording is available, skip processing
    if (!transcriptData && !recordingMetadata) {
      console.log(`[Teams Recording] No transcript or recording available for Teams meeting ${calendarEventId}`);
      return;
    }

    // Extract video recording URL from metadata
    let teamsRecordingUrl = null;
    let teamsRecordingId = null;
    if (recordingMetadata && recordingMetadata.recordings && recordingMetadata.recordings.length > 0) {
      const firstRecording = recordingMetadata.recordings[0];
      teamsRecordingUrl = firstRecording.contentDownloadUrl || 
                         firstRecording.downloadUrl || 
                         firstRecording.recordingContentUrl ||
                         firstRecording.recordingUrl ||
                         null;
      teamsRecordingId = firstRecording.id || firstRecording.recordingId || null;
      
      if (teamsRecordingUrl) {
        console.log(`[Teams Recording] Found video recording URL for ${calendarEventId}`);
      }
    }

    // If we have a recording but no transcript, we can still process it
    // The enrichment pipeline can work with video URLs (if video transcription is added)
    if (!transcriptData && teamsRecordingUrl) {
      console.log(`[Teams Recording] Video recording available but no transcript. Will store video URL for future processing.`);
    }

    // Process transcript if available
    let transcriptChunks = [];
    if (transcriptData) {
      console.log(`[Teams Recording] Successfully fetched transcript for ${calendarEventId}`);
      console.log(`[Teams Recording] Transcript content type: ${typeof transcriptData.content}`);
      console.log(`[Teams Recording] Transcript content length: ${transcriptData.content?.length || 0}`);
      
      // Debug: Show first 1000 chars with visible line endings
      const debugPreview = transcriptData.content?.substring(0, 1000)
        .replace(/\r\n/g, '[CRLF]\n')
        .replace(/\r/g, '[CR]\n')
        .replace(/\n/g, '[LF]\n');
      console.log(`[Teams Recording] Transcript content preview (with line endings):\n${debugPreview}`);

      // Parse VTT transcript into chunks
      transcriptChunks = parseVTTTranscript(transcriptData.content);

      if (transcriptChunks.length === 0) {
        console.warn(`[Teams Recording] No transcript chunks parsed from VTT content`);
        // Don't return early - still create the artifact with empty transcript
        // The transcript might be in a different format or still processing
      }

      console.log(`[Teams Recording] Parsed ${transcriptChunks.length} transcript chunks`);
    } else {
      console.log(`[Teams Recording] No transcript available, but will process with video recording if available`);
    }

    // Check if meeting artifact already exists
    let meetingArtifact = await db.MeetingArtifact.findOne({
      where: {
        calendarEventId: calendarEvent.id,
        recallEventId: calendarEvent.recallId,
      },
    });

    const calendarUserId = calendarEvent.Calendar?.userId || null;
    
    // Determine the owner based on meeting organizer
    // The organizer should be the primary owner, the calendar user is the creator
    let ownerUserId = calendarUserId;
    const organizerEmail = calendarEvent.recallData?.raw?.organizer?.emailAddress?.address;
    
    if (organizerEmail) {
      // Try to find the organizer in our user database
      const organizerUser = await db.User.findOne({
        where: db.sequelize.where(
          db.sequelize.fn('LOWER', db.sequelize.col('email')),
          organizerEmail.toLowerCase()
        ),
      });
      if (organizerUser) {
        ownerUserId = organizerUser.id;
        console.log(`[Teams Recording] Set owner to organizer: ${organizerEmail} (${ownerUserId})`);
      }
    }

    // Create or update meeting artifact
    const artifactPayload = {
      recallEventId: calendarEvent.recallId,
      calendarEventId: calendarEvent.id,
      userId: calendarUserId, // Creator (who triggered the recording)
      ownerUserId, // Owner (meeting organizer)
      eventType: "teams_recording",
      status: "received",
      ...meetingMetadata,
      // Store Teams recording URL if available
      sourceRecordingUrl: teamsRecordingUrl || null,
      rawPayload: {
        source: "microsoft_teams",
        meetingId: transcriptData?.meetingId || recordingMetadata?.meetingId || null,
        transcriptId: transcriptData?.transcriptId || null,
        recordingId: teamsRecordingId || null,
        metadata: transcriptData?.metadata || recordingMetadata?.recordings?.[0] || null,
        meetingUrl,
        title: calendarEvent.title,
        startTime: calendarEvent.startTime?.toISOString(),
        endTime: calendarEvent.endTime?.toISOString(),
        // Store video recording URL and metadata
        teamsRecordingUrl: teamsRecordingUrl,
        teamsRecordingMetadata: recordingMetadata?.recordings || null,
        // Store transcript in rawPayload for enrichment
        transcript: transcriptData?.content ? parseVTTTranscript(transcriptData.content) : null,
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

    // Store transcript chunks if available
    if (transcriptChunks.length > 0) {
      const chunkPromises = transcriptChunks.map((chunk, index) =>
        db.MeetingTranscriptChunk.create({
          meetingArtifactId: meetingArtifact.id,
          calendarEventId: calendarEvent.id,
          userId: calendarUserId,
          sequence: chunk.sequence ?? index,
          startTimeMs: chunk.startTimeMs,
          endTimeMs: chunk.endTimeMs,
          speaker: chunk.speaker,
          text: chunk.text,
        })
      );

      await Promise.all(chunkPromises);
      console.log(`[Teams Recording] Stored ${transcriptChunks.length} transcript chunks`);
    } else if (teamsRecordingUrl) {
      console.log(`[Teams Recording] No transcript chunks, but video recording URL stored for future processing`);
    }

    // Update artifact status to "done" (ready for enrichment)
    // Even if we only have video (no transcript), we can still enrich if video transcription is added later
    await meetingArtifact.update({ status: "done" });

    // Trigger enrichment pipeline
    // The enrichment will work with transcript chunks if available
    // If only video is available, enrichment can be enhanced later to transcribe video
    await backgroundQueue.add("meeting.enrich", {
      meetingArtifactId: meetingArtifact.id,
    });

    const summary = [];
    if (transcriptChunks.length > 0) {
      summary.push(`${transcriptChunks.length} transcript chunks`);
    }
    if (teamsRecordingUrl) {
      summary.push("video recording URL");
    }
    console.log(`[Teams Recording] Successfully ingested Teams meeting for ${calendarEventId} with ${summary.join(" and ")} and queued enrichment`);

  } catch (error) {
    console.error(`[Teams Recording] Error ingesting Teams recording for ${calendarEventId}:`, error);
    console.error(`[Teams Recording] Error stack:`, error.stack);
    throw error; // Re-throw to mark job as failed
  }
};


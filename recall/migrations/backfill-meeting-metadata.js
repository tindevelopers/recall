import { connect } from "../db.js";
import db from "../db.js";
import {
  extractMeetingMetadata,
  normalizeMeetingUrl,
} from "../utils/meeting-metadata-extractor.js";

/**
 * Migration to backfill meeting metadata onto existing MeetingArtifacts.
 */
export async function up() {
  await connect();

  const artifacts = await db.MeetingArtifact.findAll({
    where: { meetingPlatform: null },
    include: [{ model: db.CalendarEvent }],
  });

  console.log(`[BACKFILL] Found ${artifacts.length} artifacts missing meetingPlatform`);

  let updated = 0;
  for (const artifact of artifacts) {
    const meetingUrl =
      artifact.rawPayload?.data?.meeting_url || artifact.meetingUrl || null;
    const calendarMeetingUrl = artifact.CalendarEvent?.meetingUrl || null;

    const metadata = extractMeetingMetadata({
      meetingUrl,
      calendarMeetingUrl,
    });

    if (
      metadata.meetingPlatform ||
      metadata.meetingId ||
      metadata.displayMeetingId ||
      metadata.meetingUrl
    ) {
      await artifact.update({
        meetingPlatform: metadata.meetingPlatform,
        meetingId: metadata.meetingId,
        displayMeetingId: metadata.displayMeetingId,
        meetingUrl: metadata.meetingUrl || normalizeMeetingUrl(calendarMeetingUrl),
      });
      updated += 1;
      console.log(
        `[BACKFILL] Updated artifact ${artifact.id} -> platform=${metadata.meetingPlatform}, meetingId=${metadata.meetingId}`
      );
    }
  }

  console.log(`[BACKFILL] Completed. Updated ${updated}/${artifacts.length} artifacts.`);
}

export async function down() {
  // No-op: data backfill only
  return;
}


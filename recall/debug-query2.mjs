import db, { connect } from './db.js';
await connect();

// Get calendar events with their meeting URLs
const events = await db.CalendarEvent.findAll({ limit: 5, order: [['createdAt', 'DESC']] });
console.log('=== CALENDAR EVENTS WITH MEETING URLS ===');
for (const e of events) {
  console.log(JSON.stringify({
    id: e.id,
    recallId: e.recallId,
    title: e.title,
    meetingUrl: e.meetingUrl,
    onlineMeetingUrl: e.recallData?.raw?.onlineMeetingUrl,
    onlineMeeting: e.recallData?.raw?.onlineMeeting?.joinUrl,
  }, null, 2));
}

// Get artifacts with their meeting URLs
const artifacts = await db.MeetingArtifact.findAll({ limit: 5, order: [['createdAt', 'DESC']] });
console.log('\n=== ARTIFACTS WITH MEETING URLS ===');
for (const a of artifacts) {
  const url = a.rawPayload?.data?.meeting_url;
  console.log(JSON.stringify({
    id: a.id,
    startTime: a.rawPayload?.data?.start_time,
    meetingUrlThreadId: url?.thread_id,
    meetingUrlPlatform: url?.platform,
  }, null, 2));
}

process.exit(0);

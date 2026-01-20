import db, { connect } from './db.js';
await connect();

// Get sample artifacts with their raw data
const artifacts = await db.MeetingArtifact.findAll({ limit: 3, order: [['createdAt', 'DESC']] });
console.log('=== ARTIFACTS ===');
for (const a of artifacts) {
  console.log(JSON.stringify({
    id: a.id,
    calendarEventId: a.calendarEventId,
    recallEventId: a.recallEventId,
    payloadCalendarEventId: a.rawPayload?.data?.calendar_event_id,
    payloadTitle: a.rawPayload?.data?.title,
    payloadMeetingUrl: a.rawPayload?.data?.meeting_url,
  }, null, 2));
}

// Get sample calendar events
const events = await db.CalendarEvent.findAll({ limit: 3, order: [['createdAt', 'DESC']], include: [{ model: db.Calendar }] });
console.log('\n=== CALENDAR EVENTS ===');
for (const e of events) {
  console.log(JSON.stringify({
    id: e.id,
    recallId: e.recallId,
    title: e.title,
    platform: e.platform,
    calendarEmail: e.Calendar?.email,
    rawKeys: Object.keys(e.recallData?.raw || {}),
  }, null, 2));
}

process.exit(0);

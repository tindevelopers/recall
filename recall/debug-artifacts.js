import db, { connect } from './db.js';

async function debug() {
  await connect();

  // Check a few artifacts
  const artifacts = await db.MeetingArtifact.findAll({ 
    where: { calendarEventId: null },
    limit: 5,
    order: [['createdAt', 'DESC']]
  });

  console.log('Sample unlinked artifacts:');
  for (const a of artifacts) {
    const data = a.rawPayload?.data || {};
    console.log({
      id: a.id,
      title: data.title,
      calendar_event_id: data.calendar_event_id,
      meeting_url: typeof data.meeting_url === 'string' ? data.meeting_url.substring(0, 60) : data.meeting_url,
      start_time: data.start_time,
    });
  }

  // Check calendar events
  const events = await db.CalendarEvent.findAll({ limit: 5 });
  console.log('\nSample calendar events:');
  for (const e of events) {
    console.log({
      id: e.id,
      recallId: e.recallId,
      title: e.title,
      meeting_url: typeof e.meetingUrl === 'string' ? e.meetingUrl.substring(0, 60) : e.meetingUrl,
      start_time: e.recallData?.start_time,
    });
  }

  // Check linked artifacts
  const linkedArtifacts = await db.MeetingArtifact.findAll({ 
    where: { calendarEventId: { [db.Sequelize.Op.ne]: null } },
    limit: 5,
    include: [{ model: db.CalendarEvent }]
  });

  console.log('\nSample LINKED artifacts:');
  for (const a of linkedArtifacts) {
    const data = a.rawPayload?.data || {};
    console.log({
      id: a.id,
      title: data.title,
      calendarEventId: a.calendarEventId,
      calendarEventTitle: a.CalendarEvent?.title,
      calendar_event_id_from_payload: data.calendar_event_id,
    });
  }

  process.exit(0);
}

debug().catch(err => {
  console.error(err);
  process.exit(1);
});


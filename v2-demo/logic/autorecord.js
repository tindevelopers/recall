export async function updateAutoRecordStatusForCalendarEvents({
  calendar,
  events = [],
}) {
  if (!calendar || !events || events.length === 0) {
    return;
  }

  console.log(
    `INFO: Update auto record status for: ${calendar.id} for ${events.length} events, ${events[0].id}`
  );

  const {
    autoRecordExternalEvents,
    autoRecordInternalEvents,
    autoRecordOnlyConfirmedEvents,
    email: calendarEmail,
  } = calendar;
  
  // #region agent log
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'autorecord.js:start',message:'Auto-record settings',data:{calendarId:calendar.id,autoRecordExternalEvents,autoRecordInternalEvents,autoRecordOnlyConfirmedEvents,calendarEmail,eventCount:events.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  for (const index in events) {
    const event = events[index];
    if (event.endTime < new Date()) {
      // ignore events that have ended/ongoing
      console.log(
        `INFO: Ignoring event ${event.title} as it has ended`
      );
      continue;
    }

    // Wait until attendees are invited (not based on acceptance).
    // Many meetings won't be "confirmed" but still happen; we just need at least one invitee.
    if (!hasInvitees(event)) {
      event.shouldRecordAutomatic = false;
      await event.save();
      console.log(
        `INFO: Not scheduling yet (no invitees): '${event.title}' (${event.recallId})`
      );
      continue;
    }

    // If there's no meeting URL yet, we can't schedule a bot.
    if (!event.meetingUrl) {
      event.shouldRecordAutomatic = false;
      await event.save();
      console.log(
        `INFO: Not scheduling (no meeting URL): '${event.title}' (${event.recallId})`
      );
      continue;
    }

    let shouldRecordAutomatic = false;
    const external = isExternalEvent({ event, calendarEmail });
    shouldRecordAutomatic =
      (autoRecordExternalEvents && external) ||
      (autoRecordInternalEvents && !external);

    if (autoRecordOnlyConfirmedEvents) {
      shouldRecordAutomatic =
        shouldRecordAutomatic &&
        isConfirmedEvent({
          event,
          calendarEmail,
        });
    }

    event.shouldRecordAutomatic = shouldRecordAutomatic;
    await event.save();
    
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'autorecord.js:result',message:'Auto-record decision',data:{eventId:event.id,title:event.title,shouldRecordAutomatic,external:isExternalEvent({event,calendarEmail}),hasMeetingUrl:!!event.meetingUrl,hasInvitees:hasInvitees(event),autoRecordExternalEvents,autoRecordInternalEvents},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AB'})}).catch(()=>{});
    // #endregion
    
    console.log(
      `INFO: Updated should record automatic status of '${event.title}' to ${shouldRecordAutomatic}`
    );
  }
}

function hasInvitees(event) {
  const raw = event?.recallData?.raw || {};
  const attendees = raw["attendees"];
  return Array.isArray(attendees) && attendees.length > 0;
}

function isExternalEvent({ event, calendarEmail }) {
  return getAttendeesForCalendarEvent(event)
    .map((attendee) => attendee["email"])
    .reduce(
      (acc, attendeeEmail) =>
        acc ||
        attendeeEmail.split("@")[1].toLowerCase() !==
          calendarEmail.split("@")[1].toLowerCase(),
      false
    );
}

function isConfirmedEvent({ event, calendarEmail }) {
  return Boolean(
    getAttendeesForCalendarEvent(event).filter(
      (attendee) =>
        attendee["email"] === calendarEmail.toLowerCase() &&
        attendee["accepted"]
    )[0]
  );
}

function getAttendeesForCalendarEvent(event) {
  let attendees = [];
  if (event.platform === "google_calendar") {
    attendees = (event.recallData.raw["attendees"] || []).map((attendee) => ({
      email: attendee["email"].toLowerCase(),
      accepted: attendee["responseStatus"] === "accepted",
    }));
    attendees.push({
      email: event.recallData.raw["organizer"]["email"].toLowerCase(),
      accepted: true,
    });
  } else if (event.platform === "microsoft_outlook") {
    attendees = (event.recallData.raw["attendees"] || []).map((attendee) => ({
      email: attendee["emailAddress"]["address"].toLowerCase(),
      accepted:
        attendee["status"]["response"] === "accepted" ||
        attendee["status"]["response"] === "organizer",
    }));

    attendees.push({
      email:
        event.recallData.raw["organizer"]["emailAddress"][
          "address"
        ].toLowerCase(),
      accepted: true,
    });
  } else {
    throw new Error("PLATFORM_NOT_SUPPORTED");
  }

  return attendees;
}

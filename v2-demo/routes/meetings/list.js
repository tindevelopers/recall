import db from "../../db.js";
import { Op } from "sequelize";
const { sequelize } = db;

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;

  // Check if user has any connected calendars
  let calendars = [];
  try {
    calendars = await req.authentication.user.getCalendars();
  } catch (error) {
    console.error(`[MEETINGS] Error fetching calendars for user ${userId}:`, error);
    // Fallback: try direct database query
    try {
      calendars = await db.Calendar.findAll({
        where: { userId },
        order: [["createdAt", "ASC"]],
      });
    } catch (dbError) {
      console.error(`[MEETINGS] Error fetching calendars from database:`, dbError);
    }
  }
  
  console.log(`[MEETINGS] Found ${calendars.length} calendars for user ${userId}`);

  // Get upcoming events from all calendars (future events only)
  const now = new Date();
  const upcomingEvents = [];
  
  if (calendars.length > 0) {
    const calendarIds = calendars.map(c => c.id);
    
    // Get all events first, then filter by start time in JavaScript
    // This avoids complex SQL casting that might fail
    let allEvents = [];
    try {
      allEvents = await db.CalendarEvent.findAll({
        where: {
          calendarId: { [Op.in]: calendarIds },
        },
        include: [{ model: db.Calendar }],
        limit: 200, // Get more events to filter in memory
      });
    } catch (error) {
      console.error(`[MEETINGS] Error fetching calendar events:`, error);
      // Continue with empty events array
    }
    
    // Filter to future events
    const futureEvents = allEvents.filter(event => {
      try {
        const startTime = event.startTime;
        return startTime && new Date(startTime) > now;
      } catch (error) {
        console.error(`[MEETINGS] Error parsing start time for event ${event.id}:`, error);
        return false;
      }
    });
    
    // Sort by start time
    futureEvents.sort((a, b) => {
      try {
        const aTime = new Date(a.startTime);
        const bTime = new Date(b.startTime);
        return aTime - bTime;
      } catch (error) {
        return 0;
      }
    });
    
    // Limit to 50
    const limitedEvents = futureEvents.slice(0, 50);

    for (const event of limitedEvents) {
      upcomingEvents.push({
        id: event.id,
        title: event.title || "Untitled Meeting",
        startTime: event.startTime,
        endTime: event.endTime,
        meetingUrl: event.meetingUrl,
        platform: event.Calendar?.platform || null,
        calendarEmail: event.Calendar?.email || null,
        recordStatus: event.recordStatus,
        recallEventId: event.recallId,
      });
    }
  }

  // Get all meeting artifacts for this user with their summaries
  let artifacts = [];
  try {
    artifacts = await db.MeetingArtifact.findAll({
      where: { userId },
      include: [
        {
          model: db.CalendarEvent,
          required: false,
          include: [{ model: db.Calendar, required: false }],
        },
        {
          model: db.MeetingSummary,
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
    });
  } catch (error) {
    console.error(`[MEETINGS] Error fetching meeting artifacts:`, error);
  }

  // Also get summaries that might not have artifacts (edge case)
  let summaries = [];
  try {
    summaries = await db.MeetingSummary.findAll({
      where: { userId },
      include: [
        {
          model: db.MeetingArtifact,
          required: false,
        },
        {
          model: db.CalendarEvent,
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
    });
  } catch (error) {
    console.error(`[MEETINGS] Error fetching meeting summaries:`, error);
  }

  // Build a unified list of meetings
  const meetingsMap = new Map();

  // Add artifacts
  for (const artifact of artifacts) {
    const key = artifact.id;
    const calendarEvent = artifact.CalendarEvent;
    const summary = artifact.MeetingSummaries?.[0] || null;

    meetingsMap.set(key, {
      id: artifact.id,
      type: "artifact",
      title: calendarEvent?.title || artifact.rawPayload?.data?.title || "Untitled Meeting",
      startTime: calendarEvent?.startTime || artifact.rawPayload?.data?.start_time || artifact.createdAt,
      endTime: calendarEvent?.endTime || artifact.rawPayload?.data?.end_time || null,
      status: artifact.status,
      hasSummary: !!summary,
      hasTranscript: true, // artifacts have transcripts
      hasRecording: !!(artifact.rawPayload?.data?.video_url || artifact.rawPayload?.data?.recording_url),
      recordingUrl: artifact.rawPayload?.data?.video_url || artifact.rawPayload?.data?.recording_url || null,
      audioUrl: artifact.rawPayload?.data?.audio_url || null,
      participants: artifact.rawPayload?.data?.participants || artifact.rawPayload?.data?.attendees || [],
      calendarEmail: calendarEvent?.Calendar?.email || null,
      platform: calendarEvent?.Calendar?.platform || null,
      summaryId: summary?.id || null,
      createdAt: artifact.createdAt,
    });
  }

  // Add summaries without artifacts
  for (const summary of summaries) {
    if (summary.MeetingArtifact) continue; // Already added via artifact
    
    const calendarEvent = summary.CalendarEvent;
    const key = `summary-${summary.id}`;

    meetingsMap.set(key, {
      id: summary.id,
      type: "summary",
      title: calendarEvent?.title || "Untitled Meeting",
      startTime: calendarEvent?.startTime || summary.createdAt,
      endTime: calendarEvent?.endTime || null,
      status: summary.status,
      hasSummary: true,
      hasTranscript: false,
      hasRecording: false,
      recordingUrl: null,
      audioUrl: null,
      participants: [],
      calendarEmail: null,
      platform: null,
      summaryId: summary.id,
      createdAt: summary.createdAt,
    });
  }

  const meetings = Array.from(meetingsMap.values()).sort(
    (a, b) => new Date(b.startTime || b.createdAt) - new Date(a.startTime || a.createdAt)
  );

  return res.render("meetings.ejs", {
    notice: req.notice,
    user: req.authentication.user,
    meetings,
    upcomingEvents,
    hasCalendars: calendars.length > 0,
  });
};

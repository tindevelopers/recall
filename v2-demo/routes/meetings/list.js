import db from "../../db.js";
import { Op } from "sequelize";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;

  // Check if user has any connected calendars
  const calendars = await req.authentication.user.getCalendars();

  // Get upcoming events from all calendars (future events only)
  const now = new Date();
  const upcomingEvents = [];
  
  if (calendars.length > 0) {
    const calendarIds = calendars.map(c => c.id);
    
    const futureEvents = await db.CalendarEvent.findAll({
      where: {
        calendarId: { [Op.in]: calendarIds },
        startTime: { [Op.gt]: now },
      },
      include: [{ model: db.Calendar }],
      order: [["startTime", "ASC"]],
      limit: 50,
    });

    for (const event of futureEvents) {
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
  const artifacts = await db.MeetingArtifact.findAll({
    where: { userId },
    include: [
      {
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      },
      {
        model: db.MeetingSummary,
      },
    ],
    order: [["createdAt", "DESC"]],
  });

  // Also get summaries that might not have artifacts (edge case)
  const summaries = await db.MeetingSummary.findAll({
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

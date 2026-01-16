import db from "../../db.js";
import { Op } from "sequelize";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;

  // Check if user has any connected calendars
  const calendars = await req.authentication.user.getCalendars();

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
      platform: calendarEvent?.platform || null,
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
    hasCalendars: calendars.length > 0,
  });
};


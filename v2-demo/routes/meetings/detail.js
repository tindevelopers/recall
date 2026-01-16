import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const userId = req.authentication.user.id;
  const meetingId = req.params.id;

  // Try to find as artifact first
  let artifact = await db.MeetingArtifact.findOne({
    where: { id: meetingId, userId },
    include: [
      {
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      },
      {
        model: db.MeetingSummary,
      },
      {
        model: db.MeetingTranscriptChunk,
        order: [["sequence", "ASC"]],
      },
    ],
  });

  let summary = null;
  let transcriptChunks = [];
  let calendarEvent = null;

  if (artifact) {
    summary = artifact.MeetingSummaries?.[0] || null;
    transcriptChunks = artifact.MeetingTranscriptChunks || [];
    calendarEvent = artifact.CalendarEvent;
  } else {
    // Try to find as summary
    summary = await db.MeetingSummary.findOne({
      where: { id: meetingId, userId },
      include: [
        {
          model: db.MeetingArtifact,
          include: [
            { model: db.MeetingTranscriptChunk },
          ],
        },
        {
          model: db.CalendarEvent,
          include: [{ model: db.Calendar }],
        },
      ],
    });

    if (!summary) {
      return res.render("404.ejs", { notice: req.notice });
    }

    artifact = summary.MeetingArtifact;
    transcriptChunks = artifact?.MeetingTranscriptChunks || [];
    calendarEvent = summary.CalendarEvent;
  }

  // Build meeting data
  const meeting = {
    id: artifact?.id || summary?.id,
    title: calendarEvent?.title || artifact?.rawPayload?.data?.title || "Untitled Meeting",
    startTime: calendarEvent?.startTime || artifact?.rawPayload?.data?.start_time || artifact?.createdAt || summary?.createdAt,
    endTime: calendarEvent?.endTime || artifact?.rawPayload?.data?.end_time || null,
    status: artifact?.status || summary?.status || "completed",
    participants: artifact?.rawPayload?.data?.participants || artifact?.rawPayload?.data?.attendees || [],
    calendarEmail: calendarEvent?.Calendar?.email || null,
    platform: calendarEvent?.platform || null,
    
    // Recording URLs
    videoUrl: artifact?.rawPayload?.data?.video_url || artifact?.rawPayload?.data?.recording_url || null,
    audioUrl: artifact?.rawPayload?.data?.audio_url || null,
    
    // Summary data
    summary: summary?.summary || null,
    actionItems: summary?.actionItems || [],
    followUps: summary?.followUps || [],
    topics: summary?.topics || [],
    
    // Transcript
    transcript: transcriptChunks.map(chunk => ({
      id: chunk.id,
      speaker: chunk.speaker || "Unknown",
      text: chunk.text,
      startTimeMs: chunk.startTimeMs,
      endTimeMs: chunk.endTimeMs,
    })),
    
    // Metadata
    createdAt: artifact?.createdAt || summary?.createdAt,
    rawPayload: artifact?.rawPayload || null,
  };

  // Get publish deliveries for this meeting
  const publishDeliveries = summary ? await db.PublishDelivery.findAll({
    where: { meetingSummaryId: summary.id },
    include: [{ model: db.PublishTarget }],
    order: [["createdAt", "DESC"]],
  }) : [];

  return res.render("meeting-detail.ejs", {
    notice: req.notice,
    user: req.authentication.user,
    meeting,
    publishDeliveries,
  });
};


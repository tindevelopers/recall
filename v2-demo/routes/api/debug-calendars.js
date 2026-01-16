import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = req.authentication.user.id;

  try {
    // Get calendars directly from database
    const calendars = await db.Calendar.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
    });

    // Get calendars via association
    const calendarsViaAssociation = await req.authentication.user.getCalendars();

    // Get artifacts
    const artifacts = await db.MeetingArtifact.findAll({
      where: { userId },
      limit: 5,
      order: [["createdAt", "DESC"]],
    });

    return res.json({
      userId,
      calendarsDirect: calendars.map(c => ({
        id: c.id,
        platform: c.platform,
        recallId: c.recallId,
        recallData: c.recallData,
        status: c.status,
        email: c.email,
        createdAt: c.createdAt,
      })),
      calendarsViaAssociation: calendarsViaAssociation.map(c => ({
        id: c.id,
        platform: c.platform,
        recallId: c.recallId,
        recallData: c.recallData,
        status: c.status,
        email: c.email,
        createdAt: c.createdAt,
      })),
      calendarsCount: calendars.length,
      calendarsViaAssociationCount: calendarsViaAssociation.length,
      artifacts: artifacts.map(a => ({
        id: a.id,
        recallEventId: a.recallEventId,
        recallBotId: a.recallBotId,
        eventType: a.eventType,
        status: a.status,
        hasRawPayload: !!a.rawPayload,
        rawPayloadKeys: a.rawPayload ? Object.keys(a.rawPayload) : [],
        hasTranscript: !!(
          a.rawPayload?.data?.transcript?.segments ||
          a.rawPayload?.data?.transcript_segments ||
          a.rawPayload?.transcript?.segments
        ),
        createdAt: a.createdAt,
      })),
      artifactsCount: artifacts.length,
    });
  } catch (error) {
    console.error("Debug error:", error);
    return res.status(500).json({ 
      error: "Failed to debug", 
      message: error.message,
      stack: error.stack,
    });
  }
};

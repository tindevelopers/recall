import db from "../../db.js";
import { Op } from "sequelize";

/**
 * Public route for viewing a shared meeting via token
 * GET /meetings/shared/:token
 */
export default async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).render("error", {
        error: "Missing share token",
        message: "Please provide a valid share token.",
      });
    }

    // Find the share by token
    const share = await db.MeetingShare.findOne({
      where: {
        shareToken: token,
        status: { [Op.ne]: "revoked" },
      },
      include: [
        {
          model: db.MeetingArtifact,
          include: [
            {
              model: db.CalendarEvent,
              include: [{ model: db.Calendar }],
            },
            {
              model: db.MeetingSummary,
              limit: 1,
              order: [["createdAt", "DESC"]],
            },
            {
              model: db.MeetingTranscriptChunk,
              limit: 1000,
              order: [["startTime", "ASC"]],
            },
          ],
        },
        { model: db.User, as: "sharedByUser", attributes: ["id", "name", "email"] },
      ],
    });

    if (!share) {
      return res.status(404).render("error", {
        error: "Share not found",
        message: "This share link is invalid or has been revoked.",
      });
    }

    // Check if share has expired
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return res.status(410).render("error", {
        error: "Share expired",
        message: "This share link has expired.",
      });
    }

    const artifact = share.MeetingArtifact;
    if (!artifact) {
      return res.status(404).render("error", {
        error: "Meeting not found",
        message: "The meeting associated with this share no longer exists.",
      });
    }

    // Get meeting data similar to detail.js
    const summary = artifact.MeetingSummaries?.[0] || null;
    const transcriptChunks = artifact.MeetingTranscriptChunks || [];
    const calendarEvent = artifact.CalendarEvent;

    // Build meeting object for the view
    const meeting = {
      id: artifact.id,
      readableId: artifact.readableId || artifact.id,
      artifactId: artifact.id,
      title: artifact.title || calendarEvent?.title || "Meeting",
      startTime: calendarEvent?.startTime || artifact.createdAt,
      endTime: calendarEvent?.endTime,
      calendarEmail: calendarEvent?.Calendar?.email,
      participants: calendarEvent?.recallData?.raw?.attendees || [],
      isShared: true,
      shareInfo: {
        sharedBy: share.sharedByUser,
        accessLevel: share.accessLevel,
        shareToken: share.shareToken,
      },
      summary,
      transcriptChunks,
      calendarEvent,
    };

    // Render the meeting detail view (read-only for shared meetings)
    res.render("meeting-detail", {
      meeting,
      user: null, // No user context for public shares
      notice: null,
      isPublicShare: true,
    });
  } catch (error) {
    console.error("[MEETINGS] Error loading shared meeting:", error);
    res.status(500).render("error", {
      error: "Server error",
      message: "An error occurred while loading the shared meeting.",
    });
  }
};


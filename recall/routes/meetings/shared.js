import db from "../../db.js";
import { Op } from "sequelize";

/**
 * Strip HTML tags from text and clean up meaningless content
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return html;
  // Remove HTML tags but preserve text content
  let text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  // Remove strings that are just repeated characters (like "____" or "----")
  if (/^[_\-=~.]{3,}$/.test(text)) {
    return null;
  }
  // Remove strings that are mostly whitespace or special chars
  const alphanumericContent = text.replace(/[^a-zA-Z0-9]/g, '');
  if (alphanumericContent.length < 3) {
    return null;
  }
  return text;
}

/**
 * Extract description from a calendar event
 */
function getDescriptionFromEvent(event) {
  if (!event) return null;
  const raw = event?.recallData?.raw || {};
  
  let description = null;
  if (event.platform === "google_calendar") {
    description = raw["description"] || null;
  } else if (event.platform === "microsoft_outlook") {
    description = raw["body"]?.content || raw["bodyPreview"] || null;
  }
  
  // Strip HTML tags if present
  if (description) {
    description = stripHtml(description);
    // Return null if description is empty after stripping
    if (!description || description.length === 0) {
      return null;
    }
  }
  
  return description;
}

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

    // Recording URLs - check multiple locations including media_shortcuts
    const videoUrl = 
      artifact?.rawPayload?.data?.video_url || 
      artifact?.rawPayload?.data?.recording_url || 
      artifact?.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
      artifact?.archivedRecordingUrl ||
      null;
    const audioUrl = 
      artifact?.rawPayload?.data?.audio_url || 
      artifact?.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url ||
      null;

    // Extract description and create display title
    const extractedTitle = artifact.title || calendarEvent?.title || "Meeting";
    const description = getDescriptionFromEvent(calendarEvent);
    
    // Create display title: prefer description, otherwise use extracted title
    let displayTitle = description || extractedTitle || 'Meeting';
    if (!description && extractedTitle && extractedTitle.startsWith('Meeting on ')) {
      // Remove "Meeting on {date}" pattern
      displayTitle = extractedTitle.replace(/^Meeting on \d{1,2}\/\d{1,2}\/\d{4}$/, 'Meeting');
    }
    
    // Truncate description if it's too long for a title (keep first 100 chars)
    if (displayTitle && displayTitle.length > 100) {
      displayTitle = displayTitle.substring(0, 100).trim() + '...';
    }

    // Build meeting object for the view
    const meeting = {
      id: artifact.id,
      readableId: artifact.readableId || artifact.id,
      artifactId: artifact.id,
      title: extractedTitle,
      displayTitle: displayTitle,
      description: description,
      startTime: calendarEvent?.startTime || artifact.createdAt,
      endTime: calendarEvent?.endTime,
      calendarEmail: calendarEvent?.Calendar?.email,
      participants: calendarEvent?.recallData?.raw?.attendees || [],
      videoUrl,
      audioUrl,
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


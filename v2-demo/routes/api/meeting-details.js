import db from "../../db.js";

/**
 * Get transcript for a meeting
 * GET /api/meetings/:meetingId/transcript
 */
export async function getTranscript(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;

  try {
    // Find the meeting artifact
    const artifact = await db.MeetingArtifact.findOne({
      where: { id: meetingId, userId },
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Get transcript chunks for this artifact
    const transcriptChunks = await db.MeetingTranscriptChunk.findAll({
      where: { meetingArtifactId: artifact.id },
      order: [["timestamp", "ASC"]],
    });

    // Format transcript data
    const transcript = transcriptChunks.map(chunk => ({
      speaker: chunk.speaker || "Speaker",
      text: chunk.text,
      timestamp: chunk.timestamp,
      isFinal: chunk.isFinal,
    }));

    return res.json({ transcript });
  } catch (error) {
    console.error(`[API] Error fetching transcript for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to fetch transcript" });
  }
}

/**
 * Get AI summary for a meeting
 * GET /api/meetings/:meetingId/summary
 */
export async function getSummary(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;

  try {
    // Find the meeting artifact first
    const artifact = await db.MeetingArtifact.findOne({
      where: { id: meetingId, userId },
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Get summary for this artifact
    const summary = await db.MeetingSummary.findOne({
      where: { meetingArtifactId: artifact.id },
      order: [["createdAt", "DESC"]],
    });

    if (!summary) {
      return res.json({ summary: null });
    }

    // Parse summary content - could be JSON or plain text
    let summaryData = {
      content: summary.content,
      keyTopics: [],
      actionItems: [],
    };

    // Try to parse as JSON if it looks like JSON
    if (summary.content && summary.content.startsWith("{")) {
      try {
        const parsed = JSON.parse(summary.content);
        summaryData = {
          content: parsed.summary || parsed.content || parsed.text || summary.content,
          keyTopics: parsed.keyTopics || parsed.topics || parsed.key_topics || [],
          actionItems: parsed.actionItems || parsed.action_items || parsed.tasks || [],
        };
      } catch (e) {
        // Keep as plain text
      }
    }

    return res.json({ summary: summaryData });
  } catch (error) {
    console.error(`[API] Error fetching summary for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to fetch summary" });
  }
}

/**
 * Get action items for a meeting
 * GET /api/meetings/:meetingId/actions
 */
export async function getActionItems(req, res) {
  if (!req.authenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { meetingId } = req.params;
  const userId = req.authentication.user.id;

  try {
    // Find the meeting artifact first
    const artifact = await db.MeetingArtifact.findOne({
      where: { id: meetingId, userId },
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Get summary for this artifact (action items are typically in the summary)
    const summary = await db.MeetingSummary.findOne({
      where: { meetingArtifactId: artifact.id },
      order: [["createdAt", "DESC"]],
    });

    let actionItems = [];

    if (summary && summary.content) {
      // Try to parse action items from summary
      if (summary.content.startsWith("{")) {
        try {
          const parsed = JSON.parse(summary.content);
          actionItems = parsed.actionItems || parsed.action_items || parsed.tasks || [];
        } catch (e) {
          // Extract action items from plain text (look for bullets or numbered items)
          const lines = summary.content.split("\n");
          const actionPattern = /^[\-\*\•]\s*(.+)|^\d+[\.\)]\s*(.+)/;
          for (const line of lines) {
            const match = line.match(actionPattern);
            if (match) {
              actionItems.push({ text: match[1] || match[2] });
            }
          }
        }
      } else {
        // Try to extract from plain text
        const lines = summary.content.split("\n");
        let inActionSection = false;
        for (const line of lines) {
          if (line.toLowerCase().includes("action item") || line.toLowerCase().includes("to-do") || line.toLowerCase().includes("next step")) {
            inActionSection = true;
            continue;
          }
          if (inActionSection && line.trim()) {
            const cleanLine = line.replace(/^[\-\*\•\d\.]+\s*/, "").trim();
            if (cleanLine) {
              actionItems.push({ text: cleanLine });
            }
          }
          if (inActionSection && !line.trim()) {
            // Empty line might end action items section
            if (actionItems.length > 0) break;
          }
        }
      }
    }

    return res.json({ actionItems });
  } catch (error) {
    console.error(`[API] Error fetching action items for meeting ${meetingId}:`, error);
    return res.status(500).json({ error: "Failed to fetch action items" });
  }
}

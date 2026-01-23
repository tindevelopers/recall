import express from "express";
import db from "../../db.js";
import { Op } from "sequelize";
import crypto from "crypto";

const router = express.Router();

/**
 * Get all shares for a meeting
 * GET /api/meetings/:meetingId/shares
 */
router.get("/meetings/:meetingId/shares", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const userId = req.authentication?.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Check if user has access to this meeting (owner or has share)
    const artifact = await db.MeetingArtifact.findByPk(meetingId);
    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const isOwner = artifact.ownerUserId === userId || artifact.userId === userId;
    if (!isOwner) {
      // Check if user has admin share access
      const userShare = await db.MeetingShare.findOne({
        where: {
          meetingArtifactId: meetingId,
          sharedWithUserId: userId,
          status: "accepted",
          accessLevel: "admin",
        },
      });
      if (!userShare) {
        return res.status(403).json({ error: "You don't have permission to view shares for this meeting" });
      }
    }

    const shares = await db.MeetingShare.findAll({
      where: { meetingArtifactId: meetingId },
      include: [
        { model: db.User, as: "sharedWithUser", attributes: ["id", "name", "email"] },
        { model: db.User, as: "sharedByUser", attributes: ["id", "name", "email"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json({ shares });
  } catch (error) {
    console.error("[API] Error fetching meeting shares:", error);
    res.status(500).json({ error: "Failed to fetch shares" });
  }
});

/**
 * Share a meeting with a user or email
 * POST /api/meetings/:meetingId/shares
 * Body: { email: string, accessLevel?: 'view' | 'edit' | 'admin', notifyOnUpdates?: boolean }
 */
router.post("/meetings/:meetingId/shares", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { email, accessLevel = "view", notifyOnUpdates = true } = req.body;
    const userId = req.authentication?.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Validate access level
    if (!["view", "edit", "admin"].includes(accessLevel)) {
      return res.status(400).json({ error: "Invalid access level" });
    }

    // Check if user owns this meeting
    const artifact = await db.MeetingArtifact.findByPk(meetingId);
    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const isOwner = artifact.ownerUserId === userId || artifact.userId === userId;
    if (!isOwner) {
      // Check if user has admin share access
      const userShare = await db.MeetingShare.findOne({
        where: {
          meetingArtifactId: meetingId,
          sharedWithUserId: userId,
          status: "accepted",
          accessLevel: "admin",
        },
      });
      if (!userShare) {
        return res.status(403).json({ error: "You don't have permission to share this meeting" });
      }
    }

    // Check if target user exists
    const targetUser = await db.User.findOne({ where: { email: email.toLowerCase() } });

    // Check for existing share
    const existingShare = await db.MeetingShare.findOne({
      where: {
        meetingArtifactId: meetingId,
        [Op.or]: [
          { sharedWithUserId: targetUser?.id },
          { sharedWithEmail: email.toLowerCase() },
        ].filter(Boolean),
      },
    });

    if (existingShare) {
      if (existingShare.status === "revoked") {
        // Generate token if it doesn't exist
        const shareToken = existingShare.shareToken || crypto.randomBytes(32).toString("base64url");
        // Reactivate the share
        await existingShare.update({
          status: "pending",
          accessLevel,
          notifyOnUpdates,
          sharedByUserId: userId,
          shareToken,
        });
        const reactivatedShare = await db.MeetingShare.findByPk(existingShare.id, {
          include: [
            { model: db.User, as: "sharedWithUser", attributes: ["id", "name", "email"] },
            { model: db.User, as: "sharedByUser", attributes: ["id", "name", "email"] },
          ],
        });
        return res.json({ share: reactivatedShare, message: "Share reactivated" });
      }
      return res.status(400).json({ error: "Meeting is already shared with this user" });
    }

    // Generate a unique share token for public link
    const shareToken = crypto.randomBytes(32).toString("base64url");

    // Create the share
    const share = await db.MeetingShare.create({
      meetingArtifactId: meetingId,
      sharedWithUserId: targetUser?.id || null,
      sharedWithEmail: targetUser ? null : email.toLowerCase(),
      sharedByUserId: userId,
      accessLevel,
      notifyOnUpdates,
      status: targetUser ? "accepted" : "pending", // Auto-accept for existing users
      acceptedAt: targetUser ? new Date() : null,
      shareToken,
    });

    // Reload with associations
    const shareWithAssociations = await db.MeetingShare.findByPk(share.id, {
      include: [
        { model: db.User, as: "sharedWithUser", attributes: ["id", "name", "email"] },
        { model: db.User, as: "sharedByUser", attributes: ["id", "name", "email"] },
      ],
    });

    // TODO: Send email notification to the shared user

    res.status(201).json({ share: shareWithAssociations });
  } catch (error) {
    console.error("[API] Error sharing meeting:", error);
    res.status(500).json({ error: "Failed to share meeting" });
  }
});

/**
 * Update a share's access level
 * PATCH /api/meetings/:meetingId/shares/:shareId
 * Body: { accessLevel?: string, notifyOnUpdates?: boolean }
 */
router.patch("/meetings/:meetingId/shares/:shareId", async (req, res) => {
  try {
    const { meetingId, shareId } = req.params;
    const { accessLevel, notifyOnUpdates } = req.body;
    const userId = req.authentication?.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const share = await db.MeetingShare.findOne({
      where: { id: shareId, meetingArtifactId: meetingId },
    });

    if (!share) {
      return res.status(404).json({ error: "Share not found" });
    }

    // Check if user owns this meeting
    const artifact = await db.MeetingArtifact.findByPk(meetingId);
    const isOwner = artifact.ownerUserId === userId || artifact.userId === userId;
    if (!isOwner) {
      return res.status(403).json({ error: "Only the meeting owner can modify shares" });
    }

    const updates = {};
    if (accessLevel && ["view", "edit", "admin"].includes(accessLevel)) {
      updates.accessLevel = accessLevel;
    }
    if (typeof notifyOnUpdates === "boolean") {
      updates.notifyOnUpdates = notifyOnUpdates;
    }

    await share.update(updates);

    const updatedShare = await db.MeetingShare.findByPk(share.id, {
      include: [
        { model: db.User, as: "sharedWithUser", attributes: ["id", "name", "email"] },
        { model: db.User, as: "sharedByUser", attributes: ["id", "name", "email"] },
      ],
    });

    res.json({ share: updatedShare });
  } catch (error) {
    console.error("[API] Error updating share:", error);
    res.status(500).json({ error: "Failed to update share" });
  }
});

/**
 * Revoke a share
 * DELETE /api/meetings/:meetingId/shares/:shareId
 */
router.delete("/meetings/:meetingId/shares/:shareId", async (req, res) => {
  try {
    const { meetingId, shareId } = req.params;
    const userId = req.authentication?.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const share = await db.MeetingShare.findOne({
      where: { id: shareId, meetingArtifactId: meetingId },
    });

    if (!share) {
      return res.status(404).json({ error: "Share not found" });
    }

    // Check if user owns this meeting or is the one being shared with
    const artifact = await db.MeetingArtifact.findByPk(meetingId);
    const isOwner = artifact.ownerUserId === userId || artifact.userId === userId;
    const isShareRecipient = share.sharedWithUserId === userId;

    if (!isOwner && !isShareRecipient) {
      return res.status(403).json({ error: "You don't have permission to revoke this share" });
    }

    // Soft delete by setting status to revoked
    await share.update({ status: "revoked" });

    res.json({ success: true, message: "Share revoked" });
  } catch (error) {
    console.error("[API] Error revoking share:", error);
    res.status(500).json({ error: "Failed to revoke share" });
  }
});

/**
 * Get meetings shared with the current user
 * GET /api/shared-meetings
 */
router.get("/shared-meetings", async (req, res) => {
  try {
    const userId = req.authentication?.user?.id;
    const userEmail = req.authentication?.user?.email;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Find shares for this user (by userId or email)
    const whereClause = {
      status: "accepted",
      [Op.or]: [{ sharedWithUserId: userId }],
    };
    
    if (userEmail) {
      whereClause[Op.or].push({ sharedWithEmail: userEmail.toLowerCase() });
    }

    const shares = await db.MeetingShare.findAll({
      where: whereClause,
      include: [
        {
          model: db.MeetingArtifact,
          include: [
            { model: db.CalendarEvent, include: [db.Calendar] },
            { model: db.MeetingSummary },
          ],
        },
        { model: db.User, as: "sharedByUser", attributes: ["id", "name", "email"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.json({ shares });
  } catch (error) {
    console.error("[API] Error fetching shared meetings:", error);
    res.status(500).json({ error: "Failed to fetch shared meetings" });
  }
});

/**
 * Generate or regenerate share token for an existing share
 * POST /api/meetings/:meetingId/shares/:shareId/generate-token
 */
router.post("/meetings/:meetingId/shares/:shareId/generate-token", async (req, res) => {
  try {
    const { meetingId, shareId } = req.params;
    const userId = req.authentication?.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const share = await db.MeetingShare.findOne({
      where: { id: shareId, meetingArtifactId: meetingId },
    });

    if (!share) {
      return res.status(404).json({ error: "Share not found" });
    }

    // Check if user owns this meeting
    const artifact = await db.MeetingArtifact.findByPk(meetingId);
    const isOwner = artifact.ownerUserId === userId || artifact.userId === userId;
    if (!isOwner) {
      return res.status(403).json({ error: "Only the meeting owner can generate share tokens" });
    }

    // Generate new token
    const shareToken = crypto.randomBytes(32).toString("base64url");
    await share.update({ shareToken });

    const updatedShare = await db.MeetingShare.findByPk(share.id, {
      include: [
        { model: db.User, as: "sharedWithUser", attributes: ["id", "name", "email"] },
        { model: db.User, as: "sharedByUser", attributes: ["id", "name", "email"] },
      ],
    });

    res.json({ share: updatedShare });
  } catch (error) {
    console.error("[API] Error generating share token:", error);
    res.status(500).json({ error: "Failed to generate share token" });
  }
});

/**
 * Get attendees who can be shared with (from the meeting's calendar event)
 * GET /api/meetings/:meetingId/shareable-attendees
 */
router.get("/meetings/:meetingId/shareable-attendees", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const userId = req.authentication?.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const artifact = await db.MeetingArtifact.findByPk(meetingId, {
      include: [{ model: db.CalendarEvent }],
    });

    if (!artifact) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    // Check ownership
    const isOwner = artifact.ownerUserId === userId || artifact.userId === userId;
    if (!isOwner) {
      return res.status(403).json({ error: "Only the meeting owner can view shareable attendees" });
    }

    // Extract attendees from calendar event
    const attendees = [];
    const rawAttendees = artifact.CalendarEvent?.recallData?.raw?.attendees || [];
    
    for (const attendee of rawAttendees) {
      const email = attendee.emailAddress?.address || attendee.email;
      if (!email) continue;

      // Check if already shared
      const existingShare = await db.MeetingShare.findOne({
        where: {
          meetingArtifactId: meetingId,
          [Op.or]: [
            { sharedWithEmail: email.toLowerCase() },
          ],
          status: { [Op.ne]: "revoked" },
        },
      });

      // Check if this is a registered user
      const user = await db.User.findOne({ where: { email: email.toLowerCase() } });
      if (user) {
        const userShare = await db.MeetingShare.findOne({
          where: {
            meetingArtifactId: meetingId,
            sharedWithUserId: user.id,
            status: { [Op.ne]: "revoked" },
          },
        });
        
        attendees.push({
          email: email.toLowerCase(),
          name: attendee.emailAddress?.name || attendee.name || email,
          isRegistered: true,
          userId: user.id,
          isShared: !!userShare || !!existingShare,
          responseStatus: attendee.status?.response || attendee.responseStatus,
          isOrganizer: attendee.organizer || false,
        });
      } else {
        attendees.push({
          email: email.toLowerCase(),
          name: attendee.emailAddress?.name || attendee.name || email,
          isRegistered: false,
          userId: null,
          isShared: !!existingShare,
          responseStatus: attendee.status?.response || attendee.responseStatus,
          isOrganizer: attendee.organizer || false,
        });
      }
    }

    // Filter out the owner
    const ownerUser = await db.User.findByPk(userId);
    const filteredAttendees = attendees.filter(
      (a) => a.email.toLowerCase() !== ownerUser?.email?.toLowerCase()
    );

    res.json({ attendees: filteredAttendees });
  } catch (error) {
    console.error("[API] Error fetching shareable attendees:", error);
    res.status(500).json({ error: "Failed to fetch attendees" });
  }
});

export default router;


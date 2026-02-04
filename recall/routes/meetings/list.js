import db from "../../db.js";
import { Op } from "sequelize";
import Recall from "../../services/recall/index.js";
import { backgroundQueue } from "../../queue.js";
import { telemetryEvent } from "../../utils/telemetry.js";
import { generateUniqueReadableMeetingId } from "../../utils/meeting-id.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  extractMeetingMetadata,
  normalizeMeetingUrl as normalizeMeetingUrlUtil,
} from "../../utils/meeting-metadata-extractor.js";
const { sequelize } = db;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Use Railway-accessible path or fallback to local path
const DEBUG_LOG_PATH = process.env.RAILWAY_ENVIRONMENT 
  ? "/tmp/debug.log" 
  : path.join(__dirname, "..", "..", ".cursor", "debug.log");

function debugLog(location, message, data, hypothesisId) {
  const logEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    location,
    message,
    data,
    sessionId: "debug-session",
    runId: "upcoming-meetings-debug",
    hypothesisId: hypothesisId || "unknown",
  };
  // Always log to console for Railway visibility
  console.log(`[DEBUG] ${location}: ${message}`, JSON.stringify(data, null, 2));
  // Also try to write to file if possible
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, JSON.stringify(logEntry) + "\n");
  } catch (err) {
    // Silently fail if log file can't be written (e.g., Railway filesystem restrictions)
  }
}

function formatDigitsAsGroups(digits) {
  if (!digits || digits.length < 6) return null;
  const groups = [];
  let idx = 0;
  while (idx < digits.length) {
    const remaining = digits.length - idx;
    const size = remaining > 3 ? 3 : remaining;
    groups.push(digits.substring(idx, idx + size));
    idx += size;
  }
  return groups.join(" ");
}

function extractFriendlyMeetingIdFromText(text) {
  if (!text || typeof text !== "string") return null;
  
  // Teams HTML format: <span>Meeting ID:</span><span>220 308 722 528 88</span>
  // We need to handle the case where the ID is in a separate span after "Meeting ID:"
  // First, try to match the pattern with HTML tags between them
  const htmlMatch = text.match(/Meeting ID:[\s\S]*?<\/span>\s*<span[^>]*>([0-9\s]+)<\/span>/i);
  if (htmlMatch) {
    const digits = htmlMatch[1].replace(/\D/g, "");
    // Teams meeting IDs are typically 13-15 digits
    if (digits.length >= 13 && digits.length <= 18) {
      return formatDigitsAsGroups(digits);
    }
  }
  
  // Fallback: Look for "Meeting ID: 226 973 425 402 36" pattern in plain text
  const plainMatch = text.match(/Meeting ID:\s*([0-9\s]+)/i);
  if (plainMatch) {
    const digits = plainMatch[1].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 18) {
      return formatDigitsAsGroups(digits);
    }
  }
  
  return null;
}

function isThreadId(str) {
  // Thread IDs look like: 19:meeting_xxx@thread.v2
  if (!str || typeof str !== "string") return false;
  return str.includes("@thread.v2") || str.includes("19:meeting_");
}

function isNumericMeetingId(str) {
  // A numeric meeting ID is purely digits (with optional spaces), 13-18 digits long
  if (!str || typeof str !== "string") return false;
  const digits = str.replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 18 && /^[\d\s]+$/.test(str.trim());
}

function deriveFriendlyMeetingId({ metadataMeetingId, metadataDisplayId, calendarEvent, extraMeetingIds = [] }) {
  // FIRST: Try to extract from calendar event body (most reliable source for Teams)
  const rawDesc =
    calendarEvent?.recallData?.raw?.body?.content ||
    calendarEvent?.recallData?.raw?.bodyPreview ||
    calendarEvent?.recallData?.raw?.description ||
    null;
  const friendlyFromBody = extractFriendlyMeetingIdFromText(rawDesc);
  if (friendlyFromBody) return friendlyFromBody;

  // SECOND: Check metadata candidates, but ONLY if they look like numeric IDs (not thread IDs)
  const candidates = [
    metadataDisplayId,
    metadataMeetingId,
    ...extraMeetingIds,
  ].filter(c => c && typeof c === "string" && !isThreadId(c));

  for (const candidate of candidates) {
    if (isNumericMeetingId(candidate)) {
      const digits = candidate.replace(/\D/g, "");
      return formatDigitsAsGroups(digits);
    }
  }

  // FALLBACK: Return null if we can't find a friendly ID (don't return thread IDs)
  return null;
}

// Cache for sync operations - avoid hitting Recall API on every page load
// Key: `sync-${userId}`, Value: { lastSyncTime: Date, inProgress: boolean, syncStartTime: Date }
const syncCache = new Map();
const SYNC_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes - only sync if last sync was > 5 min ago
const SYNC_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes - reset sync if it's been in progress too long

// Disable localhost telemetry in production (causes connection errors in browser console)
// Only enable if explicitly set in development
const ENABLE_LOCAL_TELEMETRY = process.env.NODE_ENV === 'development' && process.env.ENABLE_LOCAL_TELEMETRY === 'true';
const localTelemetry = ENABLE_LOCAL_TELEMETRY 
  ? (url, data) => fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).catch(()=>{})
  : () => {}; // No-op in production to avoid connection errors

// Generic/placeholder titles we should ignore when deriving a display name
function isGenericMeetingTitle(title) {
  if (!title) return true;
  const normalized = String(title).trim().toLowerCase();
  return (
    normalized === "meeting" ||
    normalized === "untitled meeting" ||
    normalized === "untitled" ||
    normalized === "(no title)"
  );
}

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
 * Extract description from an artifact
 */
function getDescriptionFromArtifact(artifact) {
  if (!artifact) return null;
  const data = artifact?.rawPayload?.data || {};
  
  let description = null;
  // Check artifact data for description
  if (data.description) {
    description = data.description;
  } else if (data.bot_metadata?.meeting_metadata?.description) {
    // Check bot metadata
    description = data.bot_metadata.meeting_metadata.description;
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
 * Extract attendees from a calendar event for display
 */
function getAttendeesFromEvent(event) {
  const raw = event?.recallData?.raw || {};
  const attendees = [];
  
  if (event.platform === "google_calendar") {
    // Google Calendar format
    const gcalAttendees = raw["attendees"] || [];
    for (const att of gcalAttendees) {
      attendees.push({
        email: att.email,
        name: att.displayName || att.email,
        status: att.responseStatus || 'needsAction',
        organizer: att.organizer || false,
      });
    }
    // Add organizer if not in attendees
    if (raw.organizer && !attendees.find(a => a.email === raw.organizer.email)) {
      attendees.push({
        email: raw.organizer.email,
        name: raw.organizer.displayName || raw.organizer.email,
        status: 'accepted',
        organizer: true,
      });
    }
  } else if (event.platform === "microsoft_outlook") {
    // Microsoft Outlook format
    const msAttendees = raw["attendees"] || [];
    for (const att of msAttendees) {
      attendees.push({
        email: att.emailAddress?.address,
        name: att.emailAddress?.name || att.emailAddress?.address,
        status: att.status?.response || 'none',
        organizer: false,
      });
    }
    // Add organizer
    if (raw.organizer?.emailAddress) {
      attendees.push({
        email: raw.organizer.emailAddress.address,
        name: raw.organizer.emailAddress.name || raw.organizer.emailAddress.address,
        status: 'organizer',
        organizer: true,
      });
    }
  }
  
  return attendees;
}

/**
 * Normalize participants/attendees from an artifact payload
 */
function getParticipantsFromArtifact(artifact) {
  const data = artifact?.rawPayload?.data || {};
  const participants = data.participants || data.attendees || [];
  if (!Array.isArray(participants)) return [];

  // Ensure consistent shape
  return participants
    .map((p) => {
      if (!p) return null;
      return {
        email: p.email || p.address || p.user_email || p.userId || null,
        name:
          p.name ||
          p.displayName ||
          p.user_display_name ||
          p.user_name ||
          p.email ||
          null,
        status: p.status || p.responseStatus || null,
        organizer: !!p.organizer,
      };
    })
    .filter(Boolean);
}

/**
 * Build a participant list, preferring artifact data but falling back to calendar attendees.
 */
function getParticipantsForMeeting(artifact, calendarEvent) {
  const artifactParticipants = getParticipantsFromArtifact(artifact);
  if (artifactParticipants.length > 0) return artifactParticipants;
  if (calendarEvent) return getAttendeesFromEvent(calendarEvent);
  return [];
}

/**
 * Derive a human-readable meeting title from various sources.
 */
function extractMeetingTitle(artifact, calendarEvent) {
  // 1) Calendar event title
  if (calendarEvent?.title && !isGenericMeetingTitle(calendarEvent.title)) {
    return calendarEvent.title;
  }

  // 2) Artifact payload title
  if (
    artifact?.rawPayload?.data?.title &&
    !isGenericMeetingTitle(artifact.rawPayload.data.title)
  ) {
    return artifact.rawPayload.data.title;
  }

  // 3) Bot meeting_metadata title (if present)
  const botMetaTitle = artifact?.rawPayload?.data?.bot_metadata?.meeting_metadata?.title;
  if (botMetaTitle && !isGenericMeetingTitle(botMetaTitle)) {
    return botMetaTitle;
  }

  // 4) Derive from meeting URL
  const meetingUrl =
    artifact?.rawPayload?.data?.meeting_url || calendarEvent?.meetingUrl;
  if (meetingUrl) {
    const urlTitle = extractTitleFromUrl(meetingUrl);
    if (urlTitle) return urlTitle;
  }

  // 5) Build from participants (prefer artifact participants, otherwise calendar attendees)
  const participants = getParticipantsForMeeting(artifact, calendarEvent);
  if (participants.length > 0) {
    const names = participants
      .slice(0, 2)
      .map((p) => p.name || p.email?.split("@")[0])
      .filter(Boolean);
    if (names.length > 0) {
      return `Meeting with ${names.join(" and ")}${
        participants.length > 2 ? ` +${participants.length - 2}` : ""
      }`;
    }
  }

  // 6) Date-based fallback
  const startTime =
    calendarEvent?.startTime ||
    artifact?.rawPayload?.data?.start_time ||
    artifact?.createdAt;
  if (startTime) {
    const date = new Date(startTime);
    return `Meeting on ${date.toLocaleDateString()}`;
  }

  return "Untitled Meeting";
}

/**
 * Try to identify meeting platform from URL.
 */
function extractTitleFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname.toLowerCase();
    if (host.includes("zoom.us")) return "Zoom Meeting";
    if (host.includes("meet.google.com")) return "Google Meet";
    if (host.includes("teams.microsoft.com")) return "Microsoft Teams Meeting";
    if (host.includes("webex.com")) return "Webex Meeting";
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Normalize meeting URL into a string.
 */
function normalizeMeetingUrl(rawUrl) {
  if (!rawUrl) return null;
  if (typeof rawUrl === "string") return rawUrl;
  if (typeof rawUrl === "object") {
    if (rawUrl.url) return rawUrl.url;
    if (rawUrl.href) return rawUrl.href;
    if (rawUrl.link) return rawUrl.link;
  }
  return null;
}

/**
 * Helper to check if a transcript object has content
 * Transcript can be an array of segments or an object with a words array
 */
function hasTranscriptContent(transcript) {
  if (!transcript) return false;
  // Array format (direct array of segments)
  if (Array.isArray(transcript) && transcript.length > 0) return true;
  // Object format with words array
  if (transcript.words && Array.isArray(transcript.words) && transcript.words.length > 0) return true;
  // Object format with results array
  if (transcript.results && Array.isArray(transcript.results) && transcript.results.length > 0) return true;
  return false;
}

/**
 * Get the count of transcript segments for logging
 */
function getTranscriptCount(transcript) {
  if (!transcript) return 0;
  if (Array.isArray(transcript)) return transcript.length;
  if (transcript.words && Array.isArray(transcript.words)) return transcript.words.length;
  if (transcript.results && Array.isArray(transcript.results)) return transcript.results.length;
  return 0;
}

/**
 * Fetch bot data directly from Recall API and create MeetingArtifacts on-demand
 * This is a fallback for when webhooks don't reach the local server
 */
async function syncBotArtifacts(calendars, userId) {
  // Note: This sync runs in the background and processes bots that don't already have artifacts.
  // For 500+ events: The sync will fetch and process up to MAX_COMPLETED_BOTS bots per sync cycle.
  // Since we check for existing artifacts, subsequent syncs will only process new bots.
  // The UI pagination handles displaying all meetings regardless of sync limits.
  // 
  // For very old meetings (5000+): The API returns bots in reverse chronological order (newest first).
  // To handle old meetings, we:
  // 1. Fetch the newest bots first (up to MAX_COMPLETED_BOTS)
  // 2. Check the oldest synced meeting date
  // 3. On subsequent syncs, if we've synced all recent bots, fetch older bots by increasing the limit
  // 4. The incremental sync (checking for existing artifacts) ensures we don't duplicate work
  const MAX_COMPLETED_BOTS = 1000; // Increased limit to sync more meetings (was 20, then 500)
  
  // Check the oldest meeting we've synced to determine if we need to backfill
  let oldestSyncedDate = null;
  try {
    const oldestArtifact = await db.MeetingArtifact.findOne({
      where: {
        [Op.or]: [
          { userId },
          { ownerUserId: userId },
        ],
      },
      order: [['createdAt', 'ASC']],
      attributes: ['createdAt', 'rawPayload'],
    });
    
    if (oldestArtifact) {
      // Use artifact creation date or meeting start time, whichever is older
      const artifactDate = new Date(oldestArtifact.createdAt);
      const meetingDate = oldestArtifact.rawPayload?.data?.start_time 
        ? new Date(oldestArtifact.rawPayload.data.start_time)
        : null;
      oldestSyncedDate = meetingDate && meetingDate < artifactDate ? meetingDate : artifactDate;
      console.log(`[MEETINGS] Oldest synced meeting date: ${oldestSyncedDate.toISOString()}`);
    }
  } catch (error) {
    console.error(`[MEETINGS] Error checking oldest synced date:`, error.message);
  }
  
  // List recent bots directly from Recall API
  // IMPORTANT: The Recall API returns bots in reverse chronological order (newest first).
  // BEST STRATEGY FOR OLD MEETINGS:
  // Since the database stores ALL artifacts and can query them all, the key is getting them INTO the database.
  // Strategy: Fetch in progressively larger batches until we stop finding NEW bots.
  // This ensures we eventually sync all meetings, even if there are 5000+.
  let bots = [];
  let fetchLimit = MAX_COMPLETED_BOTS;
  let totalNewBotsFound = 0;
  let totalBotsProcessed = 0;
  
  // Check how many bots we already have synced
  let existingBotCount = 0;
  try {
    existingBotCount = await db.MeetingArtifact.count({
      where: {
        [Op.or]: [
          { userId },
          { ownerUserId: userId },
        ],
      },
    });
    console.log(`[MEETINGS] Currently have ${existingBotCount} meetings in database`);
  } catch (error) {
    console.error(`[MEETINGS] Error counting existing artifacts:`, error.message);
  }
  
  // If we have very old meetings synced, we might need to fetch more bots to backfill
  // Use a progressive strategy: start with normal limit, increase if we're finding many new bots
  let needsBackfill = false;
  if (oldestSyncedDate) {
    const daysSinceOldest = Math.floor((Date.now() - oldestSyncedDate.getTime()) / (1000 * 60 * 60 * 24));
    // If oldest meeting is more than 90 days old, we might have many unsynced bots
    if (daysSinceOldest > 90) {
      needsBackfill = true;
      // Increase limit for backfill (but cap at reasonable amount to avoid timeouts)
      fetchLimit = Math.min(MAX_COMPLETED_BOTS * 5, 10000); // Fetch up to 5000-10000 for backfill
      console.log(`[MEETINGS] Oldest synced meeting is ${daysSinceOldest} days old. Increasing fetch limit to ${fetchLimit} for backfill.`);
    }
  }
  
  // BEST STRATEGY: Fetch a large batch once, process all bots, skip duplicates
  // Since we check for existing artifacts before processing, we can safely fetch a large batch
  // and only process new ones. This is more efficient than multiple small fetches.
  // The database will store ALL artifacts, so once synced, they can all be found via queries.
  try {
    console.log(`[MEETINGS] Fetching bots from Recall API (limit: ${fetchLimit}${needsBackfill ? ', backfill mode' : ''})...`);
    // Fetch up to fetchLimit bots
    // The listBots function supports pagination and will fetch multiple pages if needed
    // Note: API returns newest first, so we get the most recent bots first
    bots = await Recall.listBots({ limit: fetchLimit });
    console.log(`[MEETINGS] Found ${bots.length} bots from Recall API`);
    
    // Check how many are new (don't have artifacts yet) - this helps us understand sync progress
    if (bots.length > 0) {
      const botIds = bots.map(b => b.id);
      const existingArtifacts = await db.MeetingArtifact.findAll({
        where: { recallBotId: { [Op.in]: botIds } },
        attributes: ['recallBotId'],
      });
      const existingBotIds = new Set(existingArtifacts.map(a => a.recallBotId));
      const newBotsCount = bots.filter(b => !existingBotIds.has(b.id)).length;
      console.log(`[MEETINGS] ${newBotsCount} new bots to sync out of ${bots.length} fetched`);
      
      // If we got exactly the limit and found many new bots, we might be missing older ones
      if (bots.length === fetchLimit && newBotsCount > fetchLimit * 0.8) {
        console.log(`[MEETINGS] Warning: Fetched maximum limit (${fetchLimit}) and found ${newBotsCount} new bots.`);
        console.log(`[MEETINGS] This suggests there may be more meetings beyond this limit.`);
        console.log(`[MEETINGS] For complete sync of all historical meetings, consider:`);
        console.log(`[MEETINGS] 1) Increasing MAX_COMPLETED_BOTS to 10000+ for a full backfill`);
        console.log(`[MEETINGS] 2) Running multiple sync cycles (each will catch more as new meetings are created)`);
        console.log(`[MEETINGS] 3) Once synced, all meetings are stored in database and can be found via search/filters`);
      }
    }
  } catch (error) {
    console.error(`[MEETINGS] Error listing bots from Recall API:`, error.message);
    return;
  }
  // Avoid dumping full bot statuses (can hit Railway log rate limits)
  await telemetryEvent(
    "Meetings.syncBotArtifacts.listBots",
    {
      userId,
      botCount: bots.length,
    },
    { location: "routes/meetings/list.js:syncBotArtifacts" }
  );
  
  // Filter to completed bots - check various status formats
  const completedBots = bots.filter(bot => {
    const statusCode = bot.status?.code || bot.status;
    const lastStatusChange = bot.status_changes?.[bot.status_changes?.length - 1];
    const lastStatus = lastStatusChange?.code || lastStatusChange;
    
    const effectiveStatus = statusCode || lastStatus;
    if (['media_expired', 'recording_expired'].includes(effectiveStatus)) {
      return false; // skip expired media to reduce payload/oom risk
    }

    const isComplete = ['done', 'fatal', 'analysis_done', 'recording_done'].includes(statusCode) ||
                       ['done', 'fatal', 'analysis_done', 'recording_done'].includes(lastStatus);
    
    // Note: Removed per-bot logging to reduce log noise (was logging for every bot)
    return isComplete;
  });
  
  console.log(`[MEETINGS] Found ${completedBots.length} completed bots (processing max ${fetchLimit})`);
  
  // Get calendar recallIds for matching - IMPORTANT: Only process bots that belong to this user's calendars
  const calendarRecallIds = calendars.map(c => c.recallId).filter(Boolean);
  console.log(`[MEETINGS] User's calendar recallIds: ${calendarRecallIds.join(', ')}`);
  
  // #region agent log - H10: Debug bot-to-calendar matching
  // Log the first 5 completed bots' calendar info to understand why they're not matching
  const botCalendarDebug = completedBots.slice(0, 5).map(bot => ({
    botId: bot.id,
    botName: bot.bot_name || bot.name,
    meetingUrl: typeof bot.meeting_url === 'string' ? bot.meeting_url?.substring(0, 50) : JSON.stringify(bot.meeting_url)?.substring(0, 50),
    calendarMeetings: (bot.calendar_meetings || []).map(cm => ({ id: cm.id, title: cm.title?.substring(0, 30) })),
    calendarEventId: bot.calendar_event_id,
    schedulingSource: bot.scheduling_source,
    createdAt: bot.created_at,
  }));
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'list.js:H10',message:'bot_calendar_matching',data:{userCalendarRecallIds:calendarRecallIds,userCalendarsCount:calendars.length,userCalendars:calendars.map(c=>({id:c.id,recallId:c.recallId,email:c.email})),first5BotsCalendarInfo:botCalendarDebug,completedBotsCount:completedBots.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H10'})}).catch(()=>{});
  // #endregion
  
  // Filter bots to only those belonging to this user's calendars
  // A bot belongs to a user if its calendar_meetings[].id matches one of the user's calendar recallIds
  // FIX: If bots have no calendar association (empty calendar_meetings), still process them
  // since they're from the same Recall.ai workspace and should be visible to the user
  const userBots = completedBots.filter(bot => {
    // Check if bot has calendar_meetings that match user's calendars
    const botCalendarIds = (bot.calendar_meetings || []).map(cm => cm.id);
    const matchesCalendar = botCalendarIds.some(id => calendarRecallIds.includes(id));
    
    // Also check calendar_event_id field
    const calendarEventId = bot.calendar_event_id;
    const matchesEventId = calendarEventId && calendarRecallIds.includes(calendarEventId);
    
    // If bot has calendar info, only include if it matches user's calendars
    if (botCalendarIds.length > 0 || calendarEventId) {
      return matchesCalendar || matchesEventId;
    }
    
    // FIX: If bot has NO calendar association (empty calendar_meetings and no calendar_event_id),
    // include it anyway - these are likely manually scheduled bots or bots from before
    // calendar integration was set up. They should still be visible to the workspace user.
    return true;
  });
  
  console.log(`[MEETINGS] Filtered to ${userBots.length} bots belonging to user's calendars (out of ${completedBots.length} completed)`);
  
  // #region agent log - H10b: Log filtering result
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'list.js:H10b',message:'bot_filter_result',data:{userBotsCount:userBots.length,completedBotsCount:completedBots.length,userBotsFirst3:userBots.slice(0,3).map(b=>({id:b.id,name:b.bot_name||b.name,calMeetings:b.calendar_meetings?.length||0}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H10b'})}).catch(()=>{});
  // #endregion
  
  // Process up to fetchLimit bots (which may be higher than MAX_COMPLETED_BOTS in backfill mode)
  const botsToProcess = userBots.slice(0, fetchLimit);
  
  for (const bot of botsToProcess) {
    const botId = bot.id;
    const botStatus = bot.status?.code || bot.status;
    
    // Check if we already have an artifact for this bot FOR THIS USER
    // Important: Check both userId and ownerUserId to handle artifacts created by different users
    const existingArtifact = await db.MeetingArtifact.findOne({
      where: { 
        recallBotId: botId,
        [Op.or]: [
          { userId: userId },
          { ownerUserId: userId },
        ],
      },
    });
    
    if (existingArtifact) {
      // Fetch full bot data to get recording duration
      let fullBotData = null;
      try {
        fullBotData = await Recall.getBot(botId);
        // #region agent log
        fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:syncBotArtifacts',message:'Fetched full bot data for existing artifact',data:{artifactId:existingArtifact.id,botId,hasRecordings:!!fullBotData?.recordings?.length,recordingDuration:fullBotData?.recordings?.[0]?.duration_seconds,recordingLength:fullBotData?.recordings?.[0]?.length_seconds,recordingDurationField:fullBotData?.recordings?.[0]?.duration},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-fix',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
        
        // Update artifact with recording data if available
        if (fullBotData?.recordings?.length > 0) {
          const recording = fullBotData.recordings[0];
          const updatedPayload = {
            ...existingArtifact.rawPayload,
            data: {
              ...existingArtifact.rawPayload?.data,
              recordings: fullBotData.recordings,
              media_shortcuts: recording.media_shortcuts,
              // Extract video/audio URLs
              video_url: recording.media_shortcuts?.video?.data?.download_url || existingArtifact.rawPayload?.data?.video_url,
              audio_url: recording.media_shortcuts?.audio?.data?.download_url || existingArtifact.rawPayload?.data?.audio_url,
              recording_url: recording.media_shortcuts?.video?.data?.download_url || existingArtifact.rawPayload?.data?.recording_url,
            },
          };
          await existingArtifact.update({ rawPayload: updatedPayload });
          console.log(`[MEETINGS] Updated artifact ${existingArtifact.id} with recording data`);
        }
      } catch (e) {
        console.log(`[MEETINGS] Could not fetch full bot data for ${botId}: ${e.message}`);
      }
      
      // Check if the existing artifact has transcript chunks - if not, try to create them
      let existingChunks = await db.MeetingTranscriptChunk.count({
        where: { meetingArtifactId: existingArtifact.id }
      });
      
      const existingTranscript = existingArtifact.rawPayload?.data?.transcript;
      
      // Fetch transcript if we don't have it
      let transcript = existingTranscript;
      if (!hasTranscriptContent(existingTranscript)) {
        console.log(`[MEETINGS] Existing artifact ${existingArtifact.id} missing transcript, fetching...`);
        try {
          transcript = await Recall.getBotTranscript(botId);
          console.log(`[MEETINGS] Transcript API response for ${botId}:`, JSON.stringify(transcript).substring(0, 500));
          if (hasTranscriptContent(transcript)) {
            const updatedPayload = {
              ...existingArtifact.rawPayload,
              data: {
                ...existingArtifact.rawPayload?.data,
                transcript: transcript,
              },
            };
            await existingArtifact.update({ rawPayload: updatedPayload });
            console.log(`[MEETINGS] Updated artifact ${existingArtifact.id} with transcript (${getTranscriptCount(transcript)} segments)`);
          } else {
            console.log(`[MEETINGS] No transcript available for bot ${botId} (empty response)`);
          }
        } catch (e) {
          console.log(`[MEETINGS] Could not fetch transcript for bot ${botId}: ${e.message}`);
        }
      }
      
      // Create transcript chunks if we have transcript but no chunks (or only empty chunks)
      // Check if existing chunks have empty text (bug from previous version)
      let hasEmptyChunks = false;
      if (existingChunks > 0 && existingChunks < 5) {
        const sampleChunks = await db.MeetingTranscriptChunk.findAll({
          where: { meetingArtifactId: existingArtifact.id },
          limit: 3,
        });
        hasEmptyChunks = sampleChunks.every(c => !c.text || c.text.trim().length === 0);
        if (hasEmptyChunks) {
          console.log(`[MEETINGS] Found ${existingChunks} empty transcript chunks for artifact ${existingArtifact.id}, will re-create`);
          await db.MeetingTranscriptChunk.destroy({ where: { meetingArtifactId: existingArtifact.id } });
          existingChunks = 0;
        }
      }
      
      if (existingChunks === 0 && hasTranscriptContent(transcript)) {
        console.log(`[MEETINGS] Creating transcript chunks for existing artifact ${existingArtifact.id}`);
        try {
          let chunksToCreate = [];
          
          if (Array.isArray(transcript) && transcript.length > 0 && transcript[0]?.words) {
            // Recall API format: array of participant segments with words array
            // [{ participant: { name: "..." }, words: [{ text: "...", start_timestamp: {...}, end_timestamp: {...} }] }]
            chunksToCreate = transcript.map((segment, idx) => {
              const words = segment.words || [];
              const text = words.map((w) => w.text || "").join(" ");
              
              // Extract timestamps - they can be in { relative: number, absolute: string } format
              const firstWord = words[0];
              const lastWord = words[words.length - 1];
              
              let startTimeMs = 0;
              if (firstWord?.start_timestamp) {
                if (typeof firstWord.start_timestamp.relative === 'number') {
                  startTimeMs = firstWord.start_timestamp.relative * 1000;
                } else if (typeof firstWord.start_timestamp === 'number') {
                  startTimeMs = firstWord.start_timestamp * 1000;
                }
              }
              
              let endTimeMs = 0;
              if (lastWord?.end_timestamp) {
                if (typeof lastWord.end_timestamp.relative === 'number') {
                  endTimeMs = lastWord.end_timestamp.relative * 1000;
                } else if (typeof lastWord.end_timestamp === 'number') {
                  endTimeMs = lastWord.end_timestamp * 1000;
                }
              }
              
              return {
                meetingArtifactId: existingArtifact.id,
                userId: userId,
                calendarEventId: existingArtifact.calendarEventId || null,
                sequence: idx,
                speaker: segment.participant?.name || segment.speaker || 'Speaker',
                text: text,
                startTimeMs: startTimeMs,
                endTimeMs: endTimeMs,
              };
            }).filter(chunk => chunk.text && chunk.text.trim().length > 0);
          } else if (Array.isArray(transcript)) {
            // Legacy direct array format - each item has text directly
            chunksToCreate = transcript.map((segment, idx) => ({
              meetingArtifactId: existingArtifact.id,
              userId: userId,
              calendarEventId: existingArtifact.calendarEventId || null,
              sequence: idx,
              speaker: segment.participant?.name || segment.speaker || 'Speaker',
              text: segment.text || segment.word || '',
              startTimeMs: segment.start_timestamp || segment.start_time || 0,
              endTimeMs: segment.end_timestamp || segment.end_time || 0,
            })).filter(chunk => chunk.text && chunk.text.trim().length > 0);
          } else if (transcript.words && Array.isArray(transcript.words)) {
            // Object format with words array
            chunksToCreate = transcript.words.map((word, idx) => ({
              meetingArtifactId: existingArtifact.id,
              userId: userId,
              calendarEventId: existingArtifact.calendarEventId || null,
              sequence: word.sequence || idx,
              speaker: word.speaker || 'Speaker',
              text: word.word || word.text || '',
              startTimeMs: word.start_timestamp || 0,
              endTimeMs: word.end_timestamp || 0,
            })).filter(chunk => chunk.text && chunk.text.trim().length > 0);
          } else if (transcript.results && Array.isArray(transcript.results)) {
            // Object format with results array
            chunksToCreate = transcript.results.map((result, idx) => ({
              meetingArtifactId: existingArtifact.id,
              userId: userId,
              calendarEventId: existingArtifact.calendarEventId || null,
              sequence: idx,
              speaker: result.speaker || 'Speaker',
              text: result.text || result.transcript || '',
              startTimeMs: result.start_timestamp || 0,
              endTimeMs: result.end_timestamp || 0,
            })).filter(chunk => chunk.text && chunk.text.trim().length > 0);
          }
          
          if (chunksToCreate.length > 0) {
            await db.MeetingTranscriptChunk.bulkCreate(chunksToCreate);
            console.log(`[MEETINGS] Created ${chunksToCreate.length} transcript chunks for existing artifact ${existingArtifact.id}`);
          }
        } catch (chunkError) {
          console.error(`[MEETINGS] Error creating transcript chunks for existing artifact ${existingArtifact.id}:`, chunkError.message);
        }
      }
      
      continue; // Already have this one
    }
    
    console.log(`[MEETINGS] Processing new completed bot: ${botId} (status: ${botStatus})`);
    
    // Try to find matching calendar event
    let calendarEvent = null;
    const calendarEventId = bot.calendar_meetings?.[0]?.id || bot.calendar_event_id;
    if (calendarEventId) {
      calendarEvent = await db.CalendarEvent.findOne({
        where: { recallId: calendarEventId },
        include: [{ model: db.Calendar }],
      });
    }
    
    // If no calendar event found, try matching by meeting URL
    if (!calendarEvent && bot.meeting_url) {
      const allEvents = await db.CalendarEvent.findAll({
        include: [{ model: db.Calendar }],
      });
      calendarEvent = allEvents.find(e => e.meetingUrl === bot.meeting_url);
    }
    
    // Fetch full bot data to get recording duration and other details
    let fullBotData = null;
    try {
      fullBotData = await Recall.getBot(botId);
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:syncBotArtifacts',message:'Fetched full bot data for new artifact',data:{botId,hasRecordings:!!fullBotData?.recordings?.length,recordingDuration:fullBotData?.recordings?.[0]?.duration_seconds,recordingLength:fullBotData?.recordings?.[0]?.length_seconds,recordingDurationField:fullBotData?.recordings?.[0]?.duration},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-fix',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
    } catch (e) {
      console.log(`[MEETINGS] Could not fetch full bot data for ${botId}: ${e.message}`);
    }
    
    // Fetch transcript
    let transcript = null;
    try {
      transcript = await Recall.getBotTranscript(botId);
      console.log(`[MEETINGS] Transcript API response for new bot ${botId}:`, JSON.stringify(transcript).substring(0, 500));
      if (hasTranscriptContent(transcript)) {
        console.log(`[MEETINGS] Got transcript for bot ${botId} (${getTranscriptCount(transcript)} segments)`);
      } else {
        console.log(`[MEETINGS] Empty transcript for bot ${botId}`);
        transcript = null;
      }
    } catch (e) {
      console.log(`[MEETINGS] No transcript available for bot ${botId}: ${e.message}`);
    }
    
    // Create the artifact
    try {
      const computedTitle =
        calendarEvent?.title ||
        bot.meeting_metadata?.title ||
        extractTitleFromUrl(bot.meeting_url) ||
        "Meeting";

      // Extract recording data from full bot data
      const recording = fullBotData?.recordings?.[0];
      const videoUrl = recording?.media_shortcuts?.video?.data?.download_url || bot.video_url || null;
      const audioUrl = recording?.media_shortcuts?.audio?.data?.download_url || bot.audio_url || null;

      const meetingMetadata = extractMeetingMetadata({
        meetingUrl: bot.meeting_url,
        calendarMeetingUrl: calendarEvent?.meetingUrl,
      });

      // Generate unique readable ID based on meeting start time or current time
      const meetingDate = calendarEvent?.startTime 
        ? new Date(calendarEvent.startTime)
        : (bot.join_at ? new Date(bot.join_at) : new Date());
      
      // Check uniqueness function for readableId
      const checkUnique = async (id) => {
        const existing = await db.MeetingArtifact.findOne({
          where: { readableId: id },
        });
        return !existing;
      };
      
      // Generate a temporary UUID for fallback (will be replaced by actual artifact ID)
      const tempId = uuidv4();
      const readableId = await generateUniqueReadableMeetingId(meetingDate, checkUnique, tempId);
      
      const artifact = await db.MeetingArtifact.create({
        recallEventId: calendarEvent?.recallId || null,
        recallBotId: botId,
        calendarEventId: calendarEvent?.id || null,
        userId: userId,
        eventType: 'bot.done',
        status: 'done',
        ...meetingMetadata,
        readableId: readableId,
        rawPayload: {
          event: 'bot.done',
          data: {
            bot_id: botId,
            calendar_event_id: calendarEvent?.recallId || null,
            title: computedTitle,
            start_time: bot.join_at || bot.created_at,
            end_time: bot.updated_at,
            meeting_url:
              bot.meeting_url ||
              normalizeMeetingUrlUtil(calendarEvent?.meetingUrl),
            video_url: videoUrl,
            audio_url: audioUrl,
            recording_url: videoUrl,
            transcript: transcript,
            status: botStatus,
            participants: bot.meeting_participants || [],
            // Store full recording data for duration calculation
            recordings: fullBotData?.recordings || null,
            media_shortcuts: recording?.media_shortcuts || null,
          },
          synced_from_api: true,
        },
      });
      
      console.log(`[MEETINGS] Created artifact ${artifact.id} for bot ${botId}`);
      
      // Create MeetingTranscriptChunk records for the chat API to use
      if (hasTranscriptContent(transcript)) {
        try {
          let chunksToCreate = [];
          
          if (Array.isArray(transcript) && transcript.length > 0 && transcript[0]?.words) {
            // Recall API format: array of participant segments with words array
            // [{ participant: { name: "..." }, words: [{ text: "...", start_timestamp: {...}, end_timestamp: {...} }] }]
            chunksToCreate = transcript.map((segment, idx) => {
              const words = segment.words || [];
              const text = words.map((w) => w.text || "").join(" ");
              
              // Extract timestamps - they can be in { relative: number, absolute: string } format
              const firstWord = words[0];
              const lastWord = words[words.length - 1];
              
              let startTimeMs = 0;
              if (firstWord?.start_timestamp) {
                if (typeof firstWord.start_timestamp.relative === 'number') {
                  startTimeMs = firstWord.start_timestamp.relative * 1000;
                } else if (typeof firstWord.start_timestamp === 'number') {
                  startTimeMs = firstWord.start_timestamp * 1000;
                }
              }
              
              let endTimeMs = 0;
              if (lastWord?.end_timestamp) {
                if (typeof lastWord.end_timestamp.relative === 'number') {
                  endTimeMs = lastWord.end_timestamp.relative * 1000;
                } else if (typeof lastWord.end_timestamp === 'number') {
                  endTimeMs = lastWord.end_timestamp * 1000;
                }
              }
              
              return {
                meetingArtifactId: artifact.id,
                userId: userId,
                calendarEventId: calendarEvent?.id || null,
                sequence: idx,
                speaker: segment.participant?.name || segment.speaker || 'Speaker',
                text: text,
                startTimeMs: startTimeMs,
                endTimeMs: endTimeMs,
              };
            }).filter(chunk => chunk.text && chunk.text.trim().length > 0);
          } else if (Array.isArray(transcript)) {
            // Legacy direct array format - each item has text directly
            chunksToCreate = transcript.map((segment, idx) => ({
              meetingArtifactId: artifact.id,
              userId: userId,
              calendarEventId: calendarEvent?.id || null,
              sequence: idx,
              speaker: segment.participant?.name || segment.speaker || 'Speaker',
              text: segment.text || segment.word || '',
              startTimeMs: segment.start_timestamp || segment.start_time || 0,
              endTimeMs: segment.end_timestamp || segment.end_time || 0,
            })).filter(chunk => chunk.text && chunk.text.trim().length > 0);
          } else if (transcript.words && Array.isArray(transcript.words)) {
            // Object format with words array
            chunksToCreate = transcript.words.map((word, idx) => ({
              meetingArtifactId: artifact.id,
              userId: userId,
              calendarEventId: calendarEvent?.id || null,
              sequence: word.sequence || idx,
              speaker: word.speaker || 'Speaker',
              text: word.word || word.text || '',
              startTimeMs: word.start_timestamp || 0,
              endTimeMs: word.end_timestamp || 0,
            })).filter(chunk => chunk.text && chunk.text.trim().length > 0);
          } else if (transcript.results && Array.isArray(transcript.results)) {
            // Object format with results array
            chunksToCreate = transcript.results.map((result, idx) => ({
              meetingArtifactId: artifact.id,
              userId: userId,
              calendarEventId: calendarEvent?.id || null,
              sequence: idx,
              speaker: result.speaker || 'Speaker',
              text: result.text || result.transcript || '',
              startTimeMs: result.start_timestamp || 0,
              endTimeMs: result.end_timestamp || 0,
            })).filter(chunk => chunk.text && chunk.text.trim().length > 0);
          }
          
          if (chunksToCreate.length > 0) {
            await db.MeetingTranscriptChunk.bulkCreate(chunksToCreate);
            console.log(`[MEETINGS] Created ${chunksToCreate.length} transcript chunks for artifact ${artifact.id}`);
          }
        } catch (chunkError) {
          console.error(`[MEETINGS] Error creating transcript chunks for bot ${botId}:`, chunkError.message);
        }
      }
      
      // Queue enrichment job for AI summarization, action items, and follow-ups
      // Only queue if we have transcript content or the artifact is marked as completed
      const hasTranscript = hasTranscriptContent(transcript);
      if (hasTranscript || botStatus === 'done' || botStatus === 'completed') {
        console.log(`[MEETINGS] Queueing enrichment for artifact ${artifact.id} (hasTranscript=${hasTranscript}, status=${botStatus})`);
        try {
          await backgroundQueue.add("meeting.enrich", {
            meetingArtifactId: artifact.id,
          }, {
            jobId: `enrich-${artifact.id}-sync`,
            removeOnComplete: true,
            removeOnFail: false,
          });
          console.log(`[MEETINGS] Successfully queued enrichment for artifact ${artifact.id}`);
        } catch (enrichError) {
          console.error(`[MEETINGS] Failed to queue enrichment for artifact ${artifact.id}:`, enrichError.message);
        }
      } else {
        console.log(`[MEETINGS] Skipping enrichment for artifact ${artifact.id} (no transcript, status=${botStatus})`);
      }
    } catch (error) {
      console.error(`[MEETINGS] Error creating artifact for bot ${botId}:`, error.message);
    }
  }
}

/**
 * Perform on-demand sync for a calendar to get latest events from Recall.ai
 * This ensures fresh data when viewing meetings, since webhooks can be unreliable
 */
async function syncCalendarEvents(calendar) {
  try {
    // Fetch events updated in the last 90 days OR events in the future
    // This ensures we capture:
    // 1. Recent changes (last 24h for quick updates)
    // 2. Future events that might have been created weeks/months ago
    // We use a longer window (90 days) to ensure future events are synced
    const lastUpdatedTimestamp = new Date();
    lastUpdatedTimestamp.setDate(lastUpdatedTimestamp.getDate() - 90); // 90 days ago
    
    console.log(`[MEETINGS] On-demand sync for calendar ${calendar.id} (${calendar.email})`);
    console.log(`[MEETINGS] Fetching events updated since ${lastUpdatedTimestamp.toISOString()}`);
    
    // Fetch events updated in the last 90 days - this should capture future events
    // that were created weeks/months ago but haven't been updated recently
    const events = await Recall.fetchCalendarEvents({
      id: calendar.recallId,
      lastUpdatedTimestamp: lastUpdatedTimestamp.toISOString(),
    });
    
    console.log(`[MEETINGS] Fetched ${events.length} events from Recall API`);
    
    // #region agent log
    const futureEventsSample = events.filter(event => {
      const startTime = event.start_time || event.startTime || event.start;
      if (!startTime) return false;
      try {
        return new Date(startTime) > new Date();
      } catch {
        return false;
      }
    }).slice(0, 5).map(e => ({
      id: e.id,
      title: e.title || e.subject,
      startTime: e.start_time || e.startTime || e.start,
      hasMeetingUrl: !!(e.meeting_url || e.onlineMeeting?.joinUrl),
    }));
    localTelemetry('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{location:'routes/meetings/list.js:syncCalendarEvents',message:'Events fetched from Recall API',data:{calendarId:calendar.id,calendarEmail:calendar.email,eventsCount:events.length,futureEventsCount:futureEventsSample.length,futureEventsSample},timestamp:Date.now(),sessionId:'debug-session',runId:'meetings-missing',hypothesisId:'H2'});
    // #endregion
    
    // Also check if we need to fetch future events that weren't updated recently
    // by checking if any events are in the future
    const now = new Date();
    const futureEvents = events.filter(event => {
      const startTime = event.start_time || event.startTime || event.start;
      if (!startTime) return false;
      try {
        return new Date(startTime) > now;
      } catch {
        return false;
      }
    });
    console.log(`[MEETINGS] Found ${futureEvents.length} future events in sync results`);
    
    // Sync all non-deleted events - don't filter them out
    // The database query will handle filtering for display purposes
    // This ensures we capture all events that the API returns
    const relevantEvents = events.filter(event => !event["is_deleted"]);

    let newEventsCount = 0;
    const savedEvents = [];
    for (const event of relevantEvents) {
      if (!event["is_deleted"]) {
        const [instance, created] = await db.CalendarEvent.upsert({
          recallId: event.id,
          recallData: event,
          platform: event.platform,
          updatedAt: new Date(),
          calendarId: calendar.id,
        });
        if (created) newEventsCount++;
        savedEvents.push({
          recallId: event.id,
          dbId: instance.id,
          title: event.title || event.subject,
          startTime: event.start_time || event.startTime || event.start,
          created,
        });
      }
    }
    
    // #region agent log
    localTelemetry('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{location:'routes/meetings/list.js:syncCalendarEvents',message:'Events saved to database',data:{calendarId:calendar.id,relevantEventsCount:relevantEvents.length,newEventsCount,savedEvents:savedEvents.slice(0, 5)},timestamp:Date.now(),sessionId:'debug-session',runId:'meetings-missing',hypothesisId:'H3'});
    // #endregion

    // Always run auto-record update for all synced events (not just new ones)
    // This ensures events that were synced before but never had auto-record run get processed
    if (relevantEvents.length > 0) {
      console.log(`[MEETINGS] On-demand sync processing ${relevantEvents.length} event(s) for calendar ${calendar.id} (${newEventsCount} new)`);
      const { updateAutoRecordStatusForCalendarEvents } = await import("../../logic/autorecord.js");
      const dbEvents = await db.CalendarEvent.findAll({
        where: {
          recallId: { [Op.in]: relevantEvents.filter(e => !e.is_deleted).map(e => e.id) },
          calendarId: calendar.id,
        },
      });
      await updateAutoRecordStatusForCalendarEvents({ calendar, events: dbEvents });
      // Queue bot scheduling for events that should be recorded
      // Use Promise.allSettled to avoid blocking if Redis is unavailable
      const eventsToSchedule = dbEvents.filter(event => event.shouldRecordAutomatic || event.shouldRecordManual);
      const { queueBotScheduleJob } = await import("../../utils/queue-bot-schedule.js");
      const queuePromises = eventsToSchedule.map(event => 
        queueBotScheduleJob(event.recallId, calendar.id).then(() => {
        }).catch(err => {
          console.warn(`[MEETINGS] Queue add failed (Redis unavailable?):`, err.message);
        })
      );
      // Don't await - let these run in background
      Promise.allSettled(queuePromises).catch(() => {});
      
      // Note: Teams recording ingestion is now manual-only
      // Use POST /api/trigger-teams-ingest to pull Teams recordings when needed
    }

    return relevantEvents.length;
  } catch (error) {
    console.error(`[MEETINGS] On-demand sync failed for calendar ${calendar.id}:`, error.message);
    return 0;
  }
}

export default async (req, res) => {
  // #region agent log
  const perfStart = Date.now();
  // #endregion
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }

  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const {
    q,
    from,
    to,
    hasTranscript,
    hasSummary,
    hasRecording,
    hasRecallRecording,
    hasTeamsRecording,
    sort,
    // Upcoming events filters
    upcomingQ,
    upcomingFrom,
    upcomingTo,
    upcomingSort,
    upcomingHasMeetingUrl,
    upcomingHasBot,
    upcomingHasRecording,
  } = req.query;

  const hasTranscriptFilter = hasTranscript === "true" ? true : hasTranscript === "false" ? false : null;
  const hasSummaryFilter = hasSummary === "true" ? true : hasSummary === "false" ? false : null;
  const hasRecordingFilter = hasRecording === "true" ? true : hasRecording === "false" ? false : null;
  const hasRecallRecordingFilter = hasRecallRecording === "true" ? true : hasRecallRecording === "false" ? false : null;
  const hasTeamsRecordingFilter = hasTeamsRecording === "true" ? true : hasTeamsRecording === "false" ? false : null;

  // Upcoming events filters (use separate parameters to avoid conflicts with past meetings filters)
  // Initialize with defaults to ensure they're always defined
  const upcomingQFilter = (upcomingQ || "").trim();
  const upcomingFromFilter = upcomingFrom || "";
  const upcomingToFilter = upcomingTo || "";
  // Default to chronological order (earliest/soonest first) for upcoming meetings
  const upcomingSortFilter = upcomingSort || "oldest";
  const upcomingHasMeetingUrlFilter = upcomingHasMeetingUrl === "true" ? true : upcomingHasMeetingUrl === "false" ? false : null;
  const upcomingHasBotFilter = upcomingHasBot === "true" ? true : upcomingHasBot === "false" ? false : null;
  const upcomingHasRecordingFilter = upcomingHasRecording === "true" ? true : upcomingHasRecording === "false" ? false : null;

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
  
  // #region agent log
  const calendarsDebug = calendars.map(c => ({
    id: c.id,
    recallId: c.recallId,
    email: c.email,
    platform: c.platform,
    userId: c.userId,
  }));
  const expectedBackendCalendarId = '039a4ad4-1257-4ad1-9ef4-3096bc1c8f98';
  const matchesById = calendars.some(c => c.id === expectedBackendCalendarId);
  const matchesByRecallId = calendars.some(c => c.recallId === expectedBackendCalendarId);
  debugLog('routes/meetings/list.js:calendarsFetched', 'Calendars fetched for user', { 
    userId, 
    calendarsCount: calendars.length, 
    calendars: calendarsDebug,
    expectedBackendCalendarId,
    matchesById,
    matchesByRecallId,
    matchingCalendar: calendars.find(c => c.id === expectedBackendCalendarId || c.recallId === expectedBackendCalendarId),
  }, 'H1');
  // #endregion

  // On-demand sync: fetch latest events from Recall.ai
  // OPTIMIZATION: Run sync in BACKGROUND (non-blocking) to return page instantly
  // Data will be fresh on next page load; user can also click "Refresh" button
  const syncCacheKey = `sync-${userId}`;
  const cachedSync = syncCache.get(syncCacheKey);
  const now = Date.now();
  
  // Reset sync if it's been stuck in progress for too long (likely crashed or failed)
  if (cachedSync?.inProgress && cachedSync?.syncStartTime) {
    const syncDuration = now - cachedSync.syncStartTime;
    if (syncDuration > SYNC_TIMEOUT_MS) {
      console.warn(`[MEETINGS] Sync has been in progress for ${Math.round(syncDuration / 1000)}s (timeout: ${SYNC_TIMEOUT_MS / 1000}s), resetting...`);
      syncCache.set(syncCacheKey, { 
        lastSyncTime: cachedSync.lastSyncTime || now, 
        inProgress: false 
      });
    }
  }
  
  const currentSync = syncCache.get(syncCacheKey);
  const shouldSync = !currentSync || (now - (currentSync.lastSyncTime || 0) > SYNC_THROTTLE_MS);
  const syncInProgress = currentSync?.inProgress || false;
  
  // Track sync status for UI
  let lastSyncAge = currentSync ? Math.round((now - (currentSync.lastSyncTime || 0)) / 1000) : null;
  
  // #region agent log
  localTelemetry('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{location:'routes/meetings/list.js:syncDecision',message:'Sync decision check',data:{userId,calendarsCount:calendars.length,shouldSync,lastSyncAge,syncInProgress,now,cachedSyncLastTime:currentSync?.lastSyncTime,throttleMs:SYNC_THROTTLE_MS},timestamp:Date.now(),sessionId:'debug-session',runId:'meetings-missing',hypothesisId:'H1'});
  // #endregion

  if (calendars.length > 0 && shouldSync && !syncInProgress) {
    // Mark sync as in progress to prevent concurrent syncs
    syncCache.set(syncCacheKey, { 
      lastSyncTime: now, 
      inProgress: true, 
      syncStartTime: now 
    });
    
    // Run sync in background - DON'T await, let page render immediately
    (async () => {
      const syncStartTime = Date.now();
      try {
        console.log(`[MEETINGS] Starting background sync for ${calendars.length} calendar(s)...`);
        
        // Add timeout to prevent sync from hanging forever
        const syncPromise = Promise.all(calendars.map(cal => syncCalendarEvents(cal)));
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Sync timeout after 8 minutes')), 8 * 60 * 1000)
        );
        
        await Promise.race([syncPromise, timeoutPromise]);
        console.log(`[MEETINGS] Background sync completed in ${Date.now() - syncStartTime}ms`);
        
        const botSyncStartTime = Date.now();
        const botSyncPromise = syncBotArtifacts(calendars, userId);
        const botTimeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Bot sync timeout after 2 minutes')), 2 * 60 * 1000)
        );
        
        await Promise.race([botSyncPromise, botTimeoutPromise]);
        console.log(`[MEETINGS] Background bot sync completed in ${Date.now() - botSyncStartTime}ms`);
        
        syncCache.set(syncCacheKey, { lastSyncTime: Date.now(), inProgress: false });
      } catch (err) {
        console.error(`[MEETINGS] Background sync error:`, err);
        console.error(`[MEETINGS] Sync error details:`, {
          message: err.message,
          stack: err.stack,
          duration: Date.now() - syncStartTime,
        });
        // Reset sync status so it can retry
        syncCache.set(syncCacheKey, { 
          lastSyncTime: now, 
          inProgress: false 
        });
      }
    })();
    
    console.log(`[MEETINGS] Background sync started (non-blocking)`);
  } else if (calendars.length > 0) {
    const reason = syncInProgress 
      ? `sync in progress (started ${Math.round((now - (currentSync?.syncStartTime || now)) / 1000)}s ago)`
      : `last sync was ${lastSyncAge}s ago (throttle: ${SYNC_THROTTLE_MS / 1000}s)`;
    console.log(`[MEETINGS] Skipping sync - ${reason}`);
  }

  // Get upcoming events from all calendars (future events only)
  const nowDate = new Date();
  let upcomingEvents = [];
  
  // Log environment and timezone info for debugging differences between localhost and Railway
  const envInfo = {
    nodeEnv: process.env.NODE_ENV || 'development',
    timezoneOffset: nowDate.getTimezoneOffset(),
    nowISO: nowDate.toISOString(),
    nowLocal: nowDate.toString(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  console.log(`[MEETINGS] Fetching upcoming events: calendars=${calendars.length}, envInfo=`, JSON.stringify(envInfo));
  
  if (calendars.length > 0) {
    const calendarIds = calendars.map(c => c.id);
    const calendarRecallIds = calendars.map(c => c.recallId).filter(Boolean);
    console.log(`[MEETINGS] Calendar IDs:`, calendarIds);
    console.log(`[MEETINGS] Calendar Recall IDs:`, calendarRecallIds);
    
    // #region agent log
    const expectedBackendCalendarId = '039a4ad4-1257-4ad1-9ef4-3096bc1c8f98';
    const matchesById = calendarIds.includes(expectedBackendCalendarId);
    const matchesByRecallId = calendarRecallIds.includes(expectedBackendCalendarId);
    const matchingCalendar = calendars.find(c => c.id === expectedBackendCalendarId || c.recallId === expectedBackendCalendarId);
    debugLog('routes/meetings/list.js:calendarIdsExtracted', 'Calendar IDs extracted for query', { 
      calendarIds, 
      calendarRecallIds, 
      expectedBackendCalendarId,
      matchesById,
      matchesByRecallId,
      matchingCalendar: matchingCalendar ? {
        id: matchingCalendar.id,
        recallId: matchingCalendar.recallId,
        email: matchingCalendar.email,
        platform: matchingCalendar.platform,
      } : null,
    }, 'H2');
    // #endregion
    
    // Get future events - query with a reasonable future date range (up to 2 years ahead)
    // This ensures we capture all upcoming meetings, even those scheduled far in advance
    const futureCutoff = new Date();
    futureCutoff.setFullYear(futureCutoff.getFullYear() + 2); // Look up to 2 years ahead
    console.log(`[MEETINGS] Date range: now=${nowDate.toISOString()}, futureCutoff=${futureCutoff.toISOString()}`);
    
    // Fetch all events and filter in memory - this is more reliable than database date filtering
    // since startTime might be stored as string and Sequelize date comparisons can be unreliable
    let allEvents = [];
    try {
      // Fetch all events for these calendars, then filter in memory
      // This ensures we don't miss any events due to database date type issues
      // NOTE: startTime is a VIRTUAL field (computed from recallData), so we can't order by it in the database
      // We'll sort in memory after fetching
      const allEventsUnfiltered = await db.CalendarEvent.findAll({
        where: {
          calendarId: { [Op.in]: calendarIds },
        },
        include: [{ model: db.Calendar }],
        limit: 1000, // Fetch enough to ensure we get all future events
      });
      
      console.log(`[MEETINGS] Fetched ${allEventsUnfiltered.length} total events from database`);
      
      // #region agent log
      // Count events per calendar
      const eventsPerCalendar = {};
      for (const event of allEventsUnfiltered) {
        const calId = event.calendarId;
        if (!eventsPerCalendar[calId]) {
          eventsPerCalendar[calId] = { count: 0, events: [] };
        }
        eventsPerCalendar[calId].count++;
        if (eventsPerCalendar[calId].events.length < 3) {
          eventsPerCalendar[calId].events.push({
            id: event.id,
            recallId: event.recallId,
            title: event.title,
            startTime: event.startTime,
            calendarId: event.calendarId,
          });
        }
      }
      debugLog('routes/meetings/list.js:eventsPerCalendar', 'Events count per calendar', { totalEvents: allEventsUnfiltered.length, eventsPerCalendar, calendarIds }, 'H3');
      // #endregion
      
      // Log sample events to see what we're working with
      if (allEventsUnfiltered.length > 0) {
        const sampleEvents = allEventsUnfiltered.slice(0, 3).map(e => ({
          id: e.id,
          title: e.title,
          startTime: e.startTime,
          startTimeType: typeof e.startTime,
          calendarId: e.calendarId,
        }));
        console.log(`[MEETINGS] Sample events from database:`, JSON.stringify(sampleEvents, null, 2));
      } else {
        console.log(`[MEETINGS] WARNING: No events found in database for calendars:`, calendarIds);
      }
      
      // #region agent log
      const allEventsSample = allEventsUnfiltered.slice(0, 10).map(e => ({
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        startTimeISO: e.startTime ? new Date(e.startTime).toISOString() : null,
        calendarId: e.calendarId,
        hasMeetingUrl: !!e.meetingUrl,
      }));
      debugLog('routes/meetings/list.js:queryEvents', 'Events queried from database', { totalEvents: allEventsUnfiltered.length, calendarIds, nowISO: nowDate.toISOString(), sampleEvents: allEventsSample }, 'H4');
      // #endregion
      
      // Filter to future events in memory (more reliable than database filtering)
      // Include events that start now or in the future (>= instead of >)
      // Note: JavaScript Date comparisons work correctly across timezones when using ISO strings
      const filteredEvents = [];
      const rejectedEvents = [];
      allEvents = allEventsUnfiltered.filter(event => {
        try {
          const startTime = event.startTime;
          const recallDataStartTime = event.recallData?.start_time;
          const calendarId = event.calendarId;
          
          // #region agent log
          if (!startTime || allEventsUnfiltered.indexOf(event) < 10) {
            debugLog('routes/meetings/list.js:eventFilterCheck', 'Checking event for future filter', { eventId: event.id, recallId: event.recallId, title: event.title, calendarId, startTime, recallDataStartTime, startTimeType: typeof startTime, hasStartTime: !!startTime }, 'H4');
          }
          // #endregion
          
          if (!startTime) {
            rejectedEvents.push({ id: event.id, reason: 'no_startTime', title: event.title, calendarId, recallId: event.recallId });
            console.log(`[MEETINGS] Event ${event.id} has no startTime`);
            return false;
          }
          
          // Parse startTime - it might be a string or Date object
          const startDate = new Date(startTime);
          
          // Check if date is valid
          if (isNaN(startDate.getTime())) {
            rejectedEvents.push({ id: event.id, reason: 'invalid_startTime', startTime, title: event.title, calendarId, recallId: event.recallId });
            console.log(`[MEETINGS] Event ${event.id} has invalid startTime: ${startTime}`);
            return false;
          }
          
          // Use >= to include events starting now, and <= futureCutoff to limit range
          // JavaScript Date comparisons work correctly regardless of timezone
          const isFuture = startDate >= nowDate && startDate <= futureCutoff;
          
          // Log first few events for debugging (especially on Railway)
          if (allEventsUnfiltered.indexOf(event) < 5) {
            console.log(`[MEETINGS] Event ${event.id} "${event.title}": startTime=${startTime}, startDate=${startDate.toISOString()}, nowDate=${nowDate.toISOString()}, isFuture=${isFuture}`);
          }
          
          // #region agent log
          if (calendarId === '039a4ad4-1257-4ad1-9ef4-3096bc1c8f98' || allEventsUnfiltered.indexOf(event) < 5) {
            debugLog('routes/meetings/list.js:eventDateComparison', 'Event date comparison result', { eventId: event.id, recallId: event.recallId, title: event.title, calendarId, startTime: startDate.toISOString(), nowTime: nowDate.toISOString(), futureCutoffTime: futureCutoff.toISOString(), isFuture, timeDiffMs: startDate.getTime() - nowDate.getTime() }, 'H5');
          }
          // #endregion
          
          if (isFuture) {
            filteredEvents.push({ id: event.id, title: event.title, startTime: startDate.toISOString(), calendarId });
          } else {
            rejectedEvents.push({ id: event.id, reason: 'not_future', startTime: startDate.toISOString(), nowISO: nowDate.toISOString(), title: event.title, calendarId, recallId: event.recallId });
          }
          
          return isFuture;
        } catch (error) {
          rejectedEvents.push({ id: event.id, reason: 'parse_error', error: error.message, title: event.title, calendarId: event.calendarId, recallId: event.recallId });
          console.error(`[MEETINGS] Error parsing start time for event ${event.id}:`, error);
          return false;
        }
      });
      
      console.log(`[MEETINGS] Filtered to ${allEvents.length} future events (out of ${allEventsUnfiltered.length} total)`);
      
      // #region agent log
      // Check specifically for events from the expected calendar ID (try both database ID and recallId)
      const expectedBackendCalendarId = '039a4ad4-1257-4ad1-9ef4-3096bc1c8f98';
      const matchingCalendar = calendars.find(c => c.id === expectedBackendCalendarId || c.recallId === expectedBackendCalendarId);
      const expectedCalendarDbId = matchingCalendar?.id;
      
      // Check events by database calendar ID
      const expectedCalendarEvents = expectedCalendarDbId 
        ? allEventsUnfiltered.filter(e => e.calendarId === expectedCalendarDbId)
        : [];
      const expectedCalendarFutureEvents = expectedCalendarDbId
        ? allEvents.filter(e => e.calendarId === expectedCalendarDbId)
        : [];
      const expectedCalendarRejectedEvents = expectedCalendarDbId
        ? rejectedEvents.filter(e => e.calendarId === expectedCalendarDbId)
        : [];
      
      // Also check all events to see their calendar IDs
      const allCalendarIdsInEvents = [...new Set(allEventsUnfiltered.map(e => e.calendarId))];
      const eventsByCalendarId = {};
      for (const calId of allCalendarIdsInEvents) {
        const cal = calendars.find(c => c.id === calId);
        eventsByCalendarId[calId] = {
          calendarDbId: calId,
          calendarRecallId: cal?.recallId,
          calendarEmail: cal?.email,
          totalEvents: allEventsUnfiltered.filter(e => e.calendarId === calId).length,
          futureEvents: allEvents.filter(e => e.calendarId === calId).length,
        };
      }
      
      debugLog('routes/meetings/list.js:filterEvents', 'Events filtered for display', { 
        totalEvents: allEventsUnfiltered.length, 
        filteredCount: allEvents.length, 
        rejectedCount: rejectedEvents.length, 
        nowISO: nowDate.toISOString(), 
        futureCutoffISO: futureCutoff.toISOString(), 
        rejectedEvents: rejectedEvents.slice(0, 10), 
        filteredEvents: filteredEvents.slice(0, 10), 
        expectedBackendCalendarId,
        matchingCalendar: matchingCalendar ? { id: matchingCalendar.id, recallId: matchingCalendar.recallId, email: matchingCalendar.email } : null,
        expectedCalendarDbId,
        expectedCalendarTotalEvents: expectedCalendarEvents.length, 
        expectedCalendarFutureEvents: expectedCalendarFutureEvents.length, 
        expectedCalendarRejectedEvents: expectedCalendarRejectedEvents.length, 
        expectedCalendarRejectedDetails: expectedCalendarRejectedEvents,
        eventsByCalendarId,
      }, 'H6');
      // #endregion
      
      // Sort by start time (in memory, since startTime is a virtual field)
      allEvents.sort((a, b) => {
        try {
          const aTime = a.startTime ? new Date(a.startTime) : new Date(0);
          const bTime = b.startTime ? new Date(b.startTime) : new Date(0);
          return aTime - bTime;
        } catch (error) {
          return 0;
        }
      });
    } catch (error) {
      console.error(`[MEETINGS] Error fetching calendar events:`, error);
      console.error(`[MEETINGS] Error details:`, {
        message: error.message,
        stack: error.stack,
        name: error.name,
        calendarIds: calendarIds,
      });
      allEvents = [];
    }
    
    // allEvents is already filtered to future events above
    const futureEvents = allEvents;
    console.log(`[MEETINGS] Found ${futureEvents.length} future events after filtering`);
    
    // Sort by start time (already sorted above, but keep this for consistency)
    futureEvents.sort((a, b) => {
      try {
        const aTime = new Date(a.startTime);
        const bTime = new Date(b.startTime);
        return aTime - bTime;
      } catch (error) {
        return 0;
      }
    });
    
    // Limit to 500 to show more upcoming meetings (was 50, which was too restrictive)
    // Database query already limits to 1000, so this ensures we show a reasonable number
    const limitedEvents = futureEvents.slice(0, 500);

    for (const event of limitedEvents) {
      // Determine effective transcription mode (event override > calendar default > 'realtime')
      const calendarTranscriptionMode = event.Calendar?.transcriptionMode || "realtime";
      const effectiveTranscriptionMode = event.transcriptionMode || calendarTranscriptionMode;
      
      // Determine record status based on shouldRecordAutomatic/shouldRecordManual and bots array
      let recordStatus = 'pending';
      const hasBots = event.bots && event.bots.length > 0;
      if (hasBots) {
        recordStatus = 'record';
      } else if (event.shouldRecordAutomatic || event.shouldRecordManual === true) {
        recordStatus = 'record';
      } else if (event.shouldRecordManual === false) {
        recordStatus = 'do_not_record';
      }

      // Derive bot status for display: in_meeting, meeting_finished, processed, or scheduled
      let botStatusDisplay = 'scheduled';
      if (hasBots) {
        const firstBot = event.bots[0];
        const code = (firstBot?.status?.code ?? firstBot?.status ?? '').toString().toLowerCase();
        if (['in_call_recording', 'in_call_not_recording', 'in_call', 'joined_call'].includes(code)) {
          botStatusDisplay = 'in_meeting';
        } else if (['call_ended', 'left_call', 'left'].includes(code)) {
          botStatusDisplay = 'meeting_finished';
        } else if (['done', 'analysis_done', 'recording_done'].includes(code)) {
          botStatusDisplay = 'processed';
        }
        // else: joining_call, in_waiting_room, or unknown → keep 'scheduled'
      }
      
      // Get attendees for display
      const attendees = getAttendeesFromEvent(event);
      
      
      
      upcomingEvents.push({
        id: event.id,
        title: event.title || "Untitled Meeting",
        startTime: event.startTime,
        endTime: event.endTime,
        meetingUrl: event.meetingUrl,
        platform: event.Calendar?.platform || null,
        calendarEmail: event.Calendar?.email || null,
        recordStatus,
        botStatusDisplay,  // 'scheduled' | 'in_meeting' | 'meeting_finished' | 'processed'
        recallEventId: event.recallId,
        transcriptionMode: event.transcriptionMode,  // Per-event override (null = use calendar default)
        effectiveTranscriptionMode,  // Resolved value for display
        calendarTranscriptionMode,  // Calendar default for "Default" option label
        attendees,  // Add attendees for display
        bots: event.bots || [],  // Add bots for display
        shouldRecordAutomatic: event.shouldRecordAutomatic || false,  // Auto-record status
        shouldRecordManual: event.shouldRecordManual || false,  // Manual record status
        description: getDescriptionFromEvent(event),  // Add description for merging with past meetings
      });
    }

    // Apply filters to upcoming events
    let filteredUpcomingEvents = [...upcomingEvents];

    // Search filter (title or attendees)
    if (upcomingQFilter && upcomingQFilter.trim().length > 0) {
      const qLower = upcomingQFilter.trim().toLowerCase();
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => {
        const titleMatch = (event.title || "").toLowerCase().includes(qLower);
        const attendeesMatch = (event.attendees || []).some((att) =>
          (att.name || att.email || "").toLowerCase().includes(qLower)
        );
        return titleMatch || attendeesMatch;
      });
    }

    // Date range filter
    if (upcomingFromFilter) {
      const fromDate = new Date(upcomingFromFilter);
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => {
        if (!event.startTime) return false;
        return new Date(event.startTime) >= fromDate;
      });
    }
    if (upcomingToFilter) {
      const toDate = new Date(upcomingToFilter);
      // Set to end of day
      toDate.setHours(23, 59, 59, 999);
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => {
        if (!event.startTime) return false;
        return new Date(event.startTime) <= toDate;
      });
    }

    // Has meeting URL filter
    if (upcomingHasMeetingUrlFilter === true) {
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => !!event.meetingUrl);
    } else if (upcomingHasMeetingUrlFilter === false) {
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => !event.meetingUrl);
    }

    // Has bot filter
    if (upcomingHasBotFilter === true) {
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => 
        (event.bots && event.bots.length > 0) || event.recordStatus === 'record'
      );
    } else if (upcomingHasBotFilter === false) {
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => 
        (!event.bots || event.bots.length === 0) && event.recordStatus !== 'record'
      );
    }

    // Has recording filter (auto or manual)
    if (upcomingHasRecordingFilter === true) {
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => 
        event.shouldRecordAutomatic || event.shouldRecordManual === true
      );
    } else if (upcomingHasRecordingFilter === false) {
      filteredUpcomingEvents = filteredUpcomingEvents.filter((event) => 
        !event.shouldRecordAutomatic && event.shouldRecordManual !== true
      );
    }

    // Sorting
    filteredUpcomingEvents.sort((a, b) => {
      if (upcomingSortFilter === "newest") {
        // Newest first: sort by descending startTime (latest meeting first)
        return new Date(b.startTime || 0) - new Date(a.startTime || 0);
      }
      // Default: chronological order (earliest/soonest first) - next meeting from today appears first
      return new Date(a.startTime || 0) - new Date(b.startTime || 0);
    });

    // Update upcomingEvents with filtered results
    console.log(`[MEETINGS] Upcoming events: ${upcomingEvents.length} before filters, ${filteredUpcomingEvents.length} after filters`);
    console.log(`[MEETINGS] Filter details: q="${upcomingQFilter}", from="${upcomingFromFilter}", to="${upcomingToFilter}", hasMeetingUrl=${upcomingHasMeetingUrlFilter}, hasBot=${upcomingHasBotFilter}, hasRecording=${upcomingHasRecordingFilter}`);
    upcomingEvents.length = 0;
    upcomingEvents.push(...filteredUpcomingEvents);
    console.log(`[MEETINGS] Final upcoming events count: ${upcomingEvents.length}`);
    if (upcomingEvents.length > 0) {
      console.log(`[MEETINGS] Sample upcoming events:`, upcomingEvents.slice(0, 3).map(e => ({ id: e.id, title: e.title, startTime: e.startTime })));
    }
    
    // #region agent log
    const finalUpcomingEventsSample = upcomingEvents.slice(0, 10).map(e => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime,
      calendarEmail: e.calendarEmail,
      recallEventId: e.recallEventId,
    }));
    const expectedCalendarFinalEvents = upcomingEvents.filter(e => {
      // Try to match by checking if any calendar has the expected ID
      const matchingCalendar = calendars.find(c => c.id === '039a4ad4-1257-4ad1-9ef4-3096bc1c8f98');
      return matchingCalendar && e.calendarEmail === matchingCalendar?.email;
    });
    debugLog('routes/meetings/list.js:finalUpcomingEvents', 'Final upcoming events being sent to frontend', { totalUpcomingEvents: upcomingEvents.length, beforeFilters: upcomingEvents.length + filteredUpcomingEvents.length - upcomingEvents.length, afterFilters: upcomingEvents.length, filterDetails: { q: upcomingQFilter, from: upcomingFromFilter, to: upcomingToFilter, hasMeetingUrl: upcomingHasMeetingUrlFilter, hasBot: upcomingHasBotFilter, hasRecording: upcomingHasRecordingFilter }, sampleEvents: finalUpcomingEventsSample, expectedCalendarId: '039a4ad4-1257-4ad1-9ef4-3096bc1c8f98', expectedCalendarEventsCount: expectedCalendarFinalEvents.length, expectedCalendarEvents: expectedCalendarFinalEvents }, 'H7');
    // #endregion
  } else {
    console.log(`[MEETINGS] No calendars found, skipping upcoming events fetch`);
  }

  // Build common where for time filters
  const dateFilters = {};
  if (from) {
    dateFilters[Op.gte] = new Date(from);
  }
  if (to) {
    dateFilters[Op.lte] = new Date(to);
  }

  // Get all meeting artifacts for this user with their summaries
  // Include both owned meetings and shared meetings
  let artifacts = [];
  let sharedArtifactIds = [];
  
  // First, get IDs of meetings shared with this user
  try {
    const user = await db.User.findByPk(userId);
    const shareWhereClause = {
      status: "accepted",
      [Op.or]: [{ sharedWithUserId: userId }],
    };
    if (user?.email) {
      shareWhereClause[Op.or].push({ sharedWithEmail: user.email.toLowerCase() });
    }
    
    const shares = await db.MeetingShare.findAll({
      where: shareWhereClause,
      attributes: ["meetingArtifactId"],
    });
    sharedArtifactIds = shares.map(s => s.meetingArtifactId);
  } catch (shareError) {
    console.error("[MEETINGS] Error fetching shared meetings:", shareError);
    // Continue without shared meetings if there's an error
  }
  
  // Define todayStartCheck at function scope so it's accessible in all instrumentation blocks
  const todayStartCheck = new Date();
  todayStartCheck.setHours(0, 0, 0, 0);
  
  try {
    // OPTIMIZATION: Don't include MeetingTranscriptChunk - it can have thousands of rows per artifact
    // Instead, we'll check for transcript existence separately using a count query
    // Fetch ALL artifacts (we'll paginate after filtering in JavaScript)
    const artifactResult = await db.MeetingArtifact.findAll({
      where: {
        [Op.or]: [
          { userId }, // Meetings created by this user
          { ownerUserId: userId }, // Meetings owned by this user
          ...(sharedArtifactIds.length > 0 ? [{ id: { [Op.in]: sharedArtifactIds } }] : []), // Shared meetings
        ],
      },
      distinct: true,
      include: [
        {
          model: db.CalendarEvent,
          required: false,
          where:
            Object.keys(dateFilters).length > 0
              ? { startTime: dateFilters }
              : undefined,
          include: [{ model: db.Calendar, required: false }],
        },
        {
          model: db.MeetingSummary,
          required: false,
        },
        // REMOVED: MeetingTranscriptChunk - causes N+1 query and loads thousands of rows
        // We'll check for transcript existence separately below
      ],
      order: [["createdAt", "DESC"]],
      // Remove limit/offset - we'll paginate after filtering
    });
    artifacts = artifactResult;
    
    // #region agent log
    // H1/H7: Check if today's artifacts exist in the database
    // Note: todayStartCheck is defined at function scope above
    const artifactsFromToday = artifacts.filter(a => {
      const aDate = new Date(a.createdAt);
      return aDate >= todayStartCheck;
    });
    // Also check artifacts by their actual start_time (not createdAt)
    const artifactsByStartTime = artifacts.filter(a => {
      const startTime = a.rawPayload?.data?.start_time || a.CalendarEvent?.startTime;
      if (!startTime) return false;
      const sDate = new Date(startTime);
      return sDate >= todayStartCheck;
    });
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'list.js:H1-H7',message:'artifacts_fetched',data:{totalArtifacts:artifacts.length,artifactsFromTodayByCreatedAt:artifactsFromToday.length,artifactsFromTodayByStartTime:artifactsByStartTime.length,first5Artifacts:artifacts.slice(0,5).map(a=>({id:a.id,createdAt:a.createdAt,userId:a.userId,ownerUserId:a.ownerUserId})),artifactsFromToday:artifactsFromToday.map(a=>({id:a.id,createdAt:a.createdAt})),dateFiltersApplied:Object.keys(dateFilters).length>0,todayStartCheck:todayStartCheck.toISOString()},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-H7'})}).catch(()=>{});
    // #endregion
    
    // Check for transcript chunks existence in batch (much faster than loading all chunks)
    if (artifacts.length > 0) {
      const artifactIds = artifacts.map(a => a.id);
      const chunkCounts = await db.MeetingTranscriptChunk.findAll({
        attributes: [
          'meetingArtifactId',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'chunkCount']
        ],
        where: { meetingArtifactId: { [Op.in]: artifactIds } },
        group: ['meetingArtifactId'],
        raw: true,
      });
      const chunkCountMap = new Map(
        chunkCounts.map(c => [c.meetingArtifactId, parseInt(c.chunkCount) || 0])
      );
      // Attach chunk count to each artifact
      artifacts.forEach(artifact => {
        artifact.hasTranscriptChunks = (chunkCountMap.get(artifact.id) || 0) > 0;
      });
    }
  } catch (error) {
    console.error(`[MEETINGS] Error fetching meeting artifacts:`, error);
  }

  // Match artifacts to calendar events by meeting URL thread_id
  // Runtime evidence: artifacts have rawPayload.data.meeting_url.thread_id that matches calendar event meetingUrl
  // Example: artifact thread_id "19:meeting_OGVkYjIxM2YtYWUwNy00OTdmLWFhNzItZWI0MDVlZDdkYTY3@thread.v2"
  //          matches calendar event meetingUrl containing that same thread_id
  
  // Extract thread_id from artifact meeting_url objects
  const extractThreadId = (meetingUrl) => {
    if (!meetingUrl) return null;
    // If it's an object with thread_id property (from artifact payload)
    if (typeof meetingUrl === 'object' && meetingUrl.thread_id) {
      return meetingUrl.thread_id;
    }
    // If it's a string URL, extract thread_id from it
    if (typeof meetingUrl === 'string') {
      const match = meetingUrl.match(/19:meeting_[^/@]+@thread\.v2/);
      return match ? match[0] : null;
    }
    return null;
  };
  
  // Build a map of artifact thread_ids
  const artifactThreadIds = new Set();
  for (const artifact of artifacts) {
    const threadId = extractThreadId(artifact.rawPayload?.data?.meeting_url);
    if (threadId) {
      artifactThreadIds.add(threadId);
    }
  }
  
  // Fetch ALL calendar events for this user (we already have them from upcomingEvents query, 
  // but we need past events too) and build a map by thread_id
  let calendarEventsByThreadId = new Map();
  if (artifactThreadIds.size > 0 && calendars.length > 0) {
    try {
      const calendarIds = calendars.map(c => c.id);
      const allCalendarEvents = await db.CalendarEvent.findAll({
        where: { calendarId: { [Op.in]: calendarIds } },
        include: [{ model: db.Calendar, required: false }],
      });
      
      for (const event of allCalendarEvents) {
        const threadId = extractThreadId(event.meetingUrl);
        if (threadId) {
          calendarEventsByThreadId.set(threadId, event);
        }
      }
    } catch (e) {
      console.error(`[MEETINGS] Error fetching calendar events for thread matching:`, e);
    }
  }

  // Also get summaries that might not have artifacts (edge case)
  let summaries = [];
  try {
    const summaryResult = await db.MeetingSummary.findAndCountAll({
      where: { userId },
      include: [
        {
          model: db.MeetingArtifact,
          required: false,
        },
        {
          model: db.CalendarEvent,
          required: false,
          where:
            Object.keys(dateFilters).length > 0
              ? { startTime: dateFilters }
              : undefined,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: PAGE_SIZE,
      offset,
    });
    summaries = summaryResult.rows;
  } catch (error) {
    console.error(`[MEETINGS] Error fetching meeting summaries:`, error);
  }

  // Build a unified list of meetings
  const meetingsMap = new Map();
  
  // Create a map of upcoming events by recallEventId for merging with past meetings
  const upcomingEventsByRecallId = new Map();
  for (const event of upcomingEvents) {
    if (event.recallEventId) {
      upcomingEventsByRecallId.set(event.recallEventId, event);
    }
  }

  /**
   * Generate a deduplication key for an artifact based on meeting identifiers
   * This groups artifacts that represent the same meeting
   */
  function getMeetingDeduplicationKey(artifact, calendarEvent) {
    const data = artifact.rawPayload?.data || {};
    const meetingUrl = data.meeting_url || artifact.meetingUrl;
    
    // Strategy 1: Use thread_id (most reliable for Teams meetings)
    const threadId = extractThreadId(meetingUrl);
    if (threadId) {
      return `thread:${threadId}`;
    }
    
    // Strategy 2: Use meeting ID (for Zoom, Google Meet, etc.)
    const meetingId = artifact.meetingId || 
                     data.meeting_id || 
                     data.bot_metadata?.meeting_metadata?.meeting_id ||
                     artifact.displayMeetingId;
    if (meetingId) {
      return `meetingId:${meetingId}`;
    }
    
    // Strategy 3: Use recallEventId (if available)
    const recallEventId = artifact.recallEventId || 
                         calendarEvent?.recallId ||
                         data.calendar_event_id ||
                         data.recall_event_id;
    if (recallEventId) {
      return `recallEventId:${recallEventId}`;
    }
    
    // Strategy 4: Use start time + title (within same minute)
    const startTime = data.start_time || calendarEvent?.startTime || artifact.createdAt;
    const title = data.title || calendarEvent?.title || "Untitled";
    if (startTime) {
      const startDate = new Date(startTime);
      const startMinute = startDate.toISOString().substring(0, 16); // YYYY-MM-DDTHH:MM
      return `time+title:${startMinute}:${title}`;
    }
    
    // Fallback: Use artifact ID (no deduplication possible)
    return `unique:${artifact.id}`;
  }

  /**
   * Calculate completeness score for an artifact (higher = more complete)
   * Used to determine which duplicate artifact to keep
   */
  function getArtifactCompletenessScore(artifact, hasTranscriptFlag, summary, hasRecordingFlag) {
    let score = 0;
    
    // Transcript is most valuable (2 points)
    if (hasTranscriptFlag) {
      score += 2;
    }
    
    // Summary is valuable (2 points)
    if (summary) {
      score += 2;
    }
    
    // Recording is valuable (1 point)
    if (hasRecordingFlag) {
      score += 1;
    }
    
    // Prefer artifacts with recallBotId (actual recordings vs placeholders)
    if (artifact.recallBotId) {
      score += 1;
    }
    
    // Prefer newer artifacts (they may have more complete data)
    const ageInDays = (Date.now() - new Date(artifact.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - ageInDays / 30); // Bonus for artifacts less than 30 days old
    
    return score;
  }

  // Add artifacts
  for (const artifact of artifacts) {
    // Generate deduplication key
    const artifactThreadId = extractThreadId(artifact.rawPayload?.data?.meeting_url);
    const calendarEvent =
      artifact.CalendarEvent ||
      (artifactThreadId ? calendarEventsByThreadId.get(artifactThreadId) : null);
    
    // We need to calculate some values before generating the key
    const summary = artifact.MeetingSummaries?.[0] || artifact.MeetingSummary || null;
    const hasTranscriptFromPayload = hasTranscriptContent(artifact.rawPayload?.data?.transcript);
    const hasTranscriptFromChunks = artifact.hasTranscriptChunks || false;
    const hasTranscriptFlag = hasTranscriptFromPayload || hasTranscriptFromChunks;
    const hasRecordingFlag = !!(
      artifact.rawPayload?.data?.video_url ||
      artifact.rawPayload?.data?.recording_url ||
      artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url
    );
    
    // Generate deduplication key (need friendlyMeetingId for this)
    const storedMeetingUrl =
      artifact.meetingUrl ||
      normalizeMeetingUrlUtil(artifact.rawPayload?.data?.meeting_url) ||
      normalizeMeetingUrlUtil(calendarEvent?.meetingUrl);
    const metadata = extractMeetingMetadata({
      meetingUrl: storedMeetingUrl,
      calendarMeetingUrl: calendarEvent?.meetingUrl,
    });
    const friendlyMeetingId = deriveFriendlyMeetingId({
      metadataMeetingId: artifact.meetingId || metadata.meetingId,
      metadataDisplayId: artifact.displayMeetingId || metadata.displayMeetingId,
      calendarEvent,
      extraMeetingIds: [
        artifact.rawPayload?.data?.bot_metadata?.meeting_metadata?.meeting_id,
        artifact.rawPayload?.data?.meeting_metadata?.meeting_id,
        calendarEvent?.recallData?.raw?.onlineMeeting?.meetingId,
      ],
    });
    
    const dedupeKey = getMeetingDeduplicationKey(artifact, calendarEvent);
    
    // #region agent log
    // H4: Log deduplication for today's artifacts
    const artifactCreatedToday = new Date(artifact.createdAt) >= todayStartCheck;
    if (artifactCreatedToday) {
      console.log(`[DEBUG] H4:dedupe_today`, JSON.stringify({artifactId:artifact.id,artifactCreatedAt:artifact.createdAt,dedupeKey,hasExistingMeeting:meetingsMap.has(dedupeKey),existingMeetingId:meetingsMap.get(dedupeKey)?.id,existingMeetingCreatedAt:meetingsMap.get(dedupeKey)?.createdAt}));
    }
    // #endregion
    
    // Check if we already have a meeting with this key
    const existingMeeting = meetingsMap.get(dedupeKey);
    
    if (existingMeeting && existingMeeting.type === "artifact") {
      // We have a duplicate - keep the one with higher completeness score
      // Calculate score for existing meeting (using meeting data)
      const existingScore = 
        (existingMeeting.hasTranscript ? 2 : 0) +
        (existingMeeting.hasSummary ? 2 : 0) +
        (existingMeeting.hasRecording ? 1 : 0) +
        (existingMeeting.hasRecallRecording ? 1 : 0) +
        Math.max(0, 1 - (Date.now() - new Date(existingMeeting.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30));
      
      // Calculate score for current artifact
      const currentScore = getArtifactCompletenessScore(
        artifact,
        hasTranscriptFlag,
        summary,
        hasRecordingFlag
      );
      
      // If current artifact is not better, skip it
      if (currentScore <= existingScore) {
        // #region agent log
        if (artifactCreatedToday) {
          fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:dedupe_skip_today',message:'SKIPPING today artifact due to lower score',data:{artifactId:artifact.id,currentScore,existingScore,existingMeetingId:existingMeeting.id,existingMeetingCreatedAt:existingMeeting.createdAt,dedupeKey},timestamp:Date.now(),sessionId:'debug-session',runId:'past-meetings-debug',hypothesisId:'H4'})}).catch(()=>{});
        }
        // #endregion
        console.log(`[MEETINGS] Skipping duplicate artifact ${artifact.id} (score: ${currentScore} <= ${existingScore}) for meeting key: ${dedupeKey}`);
        continue;
      }
      
      // Current artifact is better - replace the existing one
      console.log(`[MEETINGS] Replacing duplicate artifact ${existingMeeting.id} (score: ${existingScore}) with ${artifact.id} (score: ${currentScore}) for meeting key: ${dedupeKey}`);
    }
    
    const key = dedupeKey;
    
    // Prioritize artifact data for start/end times
    const artifactStartTime = artifact.rawPayload?.data?.start_time;
    const artifactEndTime = artifact.rawPayload?.data?.end_time;
    const startTime = artifactStartTime || calendarEvent?.startTime || artifact.createdAt;
    const endTime = artifactEndTime || calendarEvent?.endTime || null;

    const participants = getParticipantsForMeeting(artifact, calendarEvent);
    
    // Check if this is a Recall recording (has artifact with recording) vs platform recording
    const hasRecallRecordingFlag = hasRecordingFlag && !!artifact.recallBotId;

    // Check if this is a Teams recording
    const hasTeamsRecordingFlag =
      artifact.eventType === "teams_recording" ||
      artifact.rawPayload?.source === "microsoft_teams" ||
      (typeof artifact.rawPayload?.data?.meetingUrl === "string" &&
        artifact.rawPayload.data.meetingUrl.includes("teams.microsoft.com")) ||
      (calendarEvent?.meetingUrl && calendarEvent.meetingUrl.includes("teams.microsoft.com"));

    const teamsRecordingUrl =
      artifact.rawPayload?.data?.teamsRecordingUrl ||
      artifact.rawPayload?.data?.teams_video_url ||
      artifact.rawPayload?.teamsRecordingUrl ||
      artifact.rawPayload?.data?.sharePointRecordingUrl ||
      (hasTeamsRecordingFlag ? artifact.sourceRecordingUrl : null) ||
      null;

    const recordingSource = hasRecallRecordingFlag
      ? "recall"
      : hasTeamsRecordingFlag
        ? "teams"
        : hasRecordingFlag
          ? "external"
          : null;

    // Use existing artifact data - don't fetch bot data on-demand as it causes N+1 API calls (600+ requests!)
    // Duration will be calculated from existing data or shown as unknown
    const artifactData = artifact.rawPayload?.data || {};

    // Calculate duration from artifacts first, then fallback to calendar event times
    const durationSeconds = (() => {
      // #region agent log
      const durationDebug = {
        artifactId: artifact.id,
        artifactStartTime,
        artifactEndTime,
        calendarStartTime: startTime,
        calendarEndTime: endTime,
        durationSecondsField: artifactData.duration_seconds,
        recordingDuration: artifactData.recording?.duration || artifactData.recording_duration,
        botDuration: artifactData.bot?.duration || artifactData.bot_duration,
        recordingsExists: !!artifactData.recordings,
        recordingsIsArray: Array.isArray(artifactData.recordings),
        recordingsLength: Array.isArray(artifactData.recordings) ? artifactData.recordings.length : null,
        recordingsArray: artifactData.recordings?.[0] ? {
          duration: artifactData.recordings[0].duration,
          duration_seconds: artifactData.recordings[0].duration_seconds,
          length: artifactData.recordings[0].length,
          length_seconds: artifactData.recordings[0].length_seconds,
          keys: Object.keys(artifactData.recordings[0] || {}),
        } : null,
        mediaShortcuts: artifactData.media_shortcuts ? Object.keys(artifactData.media_shortcuts) : null,
        rawPayloadKeys: Object.keys(artifactData),
      };
      // #endregion
      
      // First priority: use recording duration from Recall API (most accurate)
      if (artifactData.recordings?.[0]?.duration_seconds) {
        // #region agent log
        fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'Using recording duration_seconds from recordings array',data:{...durationDebug,calculatedDuration:artifactData.recordings[0].duration_seconds,source:'recordings[0].duration_seconds'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        return artifactData.recordings[0].duration_seconds;
      }
      if (artifactData.recordings?.[0]?.duration) {
        // #region agent log
        const durSec = typeof artifactData.recordings[0].duration === 'number' ? artifactData.recordings[0].duration : null;
        fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'Using recording duration from recordings array',data:{...durationDebug,calculatedDuration:durSec,source:'recordings[0].duration'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        return durSec;
      }
      if (artifactData.recordings?.[0]?.length_seconds) {
        // #region agent log
        fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'Using recording length_seconds from recordings array',data:{...durationDebug,calculatedDuration:artifactData.recordings[0].length_seconds,source:'recordings[0].length_seconds'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        return artifactData.recordings[0].length_seconds;
      }
      
      // Second priority: calculate duration from transcript timestamps (more accurate than calendar times)
      const transcript = artifactData.transcript;
      if (hasTranscriptContent(transcript)) {
        let maxEndTime = 0;
        // Try to find the maximum end timestamp in the transcript
        if (Array.isArray(transcript) && transcript.length > 0) {
          // Format: [{ participant: {...}, words: [{ end_timestamp: {...} }] }]
          if (transcript[0]?.words) {
            for (const segment of transcript) {
              const words = segment.words || [];
              for (const word of words) {
                if (word.end_timestamp) {
                  const endTime = typeof word.end_timestamp === 'number' 
                    ? word.end_timestamp 
                    : word.end_timestamp.relative;
                  if (typeof endTime === 'number' && endTime > maxEndTime) {
                    maxEndTime = endTime;
                  }
                }
              }
            }
          } else {
            // Format: [{ end_timestamp: number, end_time: number }]
            for (const segment of transcript) {
              const endTime = segment.end_timestamp || segment.end_time;
              if (typeof endTime === 'number' && endTime > maxEndTime) {
                maxEndTime = endTime;
              }
            }
          }
        } else if (transcript.words && Array.isArray(transcript.words)) {
          // Format: { words: [{ end_timestamp: number }] }
          for (const word of transcript.words) {
            const endTime = word.end_timestamp || word.end_time;
            if (typeof endTime === 'number' && endTime > maxEndTime) {
              maxEndTime = endTime;
            }
          }
        }
        
        if (maxEndTime > 0) {
          // Convert to seconds (timestamps are usually in seconds already, but check if they're in milliseconds)
          const durationSec = maxEndTime > 1000000 ? maxEndTime / 1000 : maxEndTime;
          // #region agent log
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'Using duration from transcript timestamps',data:{...durationDebug,calculatedDuration:durationSec,maxEndTime,source:'transcript_timestamps'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'G'})}).catch(()=>{});
          // #endregion
          return durationSec;
        }
      }
      
      // Third priority: use artifact start/end times (from actual recording)
      if (artifactStartTime && artifactEndTime) {
        const calcDuration = Math.max(0, (new Date(artifactEndTime) - new Date(artifactStartTime)) / 1000);
        // #region agent log
        fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'Using artifact start/end times',data:{...durationDebug,calculatedDuration:calcDuration,source:'artifact_start_end_times'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        return calcDuration;
      }
      
      // Fourth priority: check for duration directly in artifact data
      if (artifactData.duration_seconds) {
        // #region agent log
        fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'Using duration_seconds from artifact data',data:{...durationDebug,calculatedDuration:artifactData.duration_seconds,source:'duration_seconds'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        return artifactData.duration_seconds;
      }
      
      // Fifth priority: use calendar event times (scheduled, may not match actual recording)
      // BUT: Skip if duration is clearly wrong (>24 hours suggests recurring event bug)
      if (startTime && endTime) {
        const calcDuration = Math.max(0, (new Date(endTime) - new Date(startTime)) / 1000);
        // Sanity check: if duration is >24 hours, it's likely a recurring event bug - skip it
        if (calcDuration > 24 * 3600) {
          // #region agent log
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'Skipping calendar event times - duration too large (likely recurring event bug)',data:{...durationDebug,calculatedDuration:calcDuration,source:'calendar_event_times_rejected'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          // Don't return - continue to next fallback
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'Using calendar event times (scheduled)',data:{...durationDebug,calculatedDuration:calcDuration,source:'calendar_event_times'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          return calcDuration;
        }
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:duration_calc',message:'No duration found',data:{...durationDebug,calculatedDuration:null,source:'none'},timestamp:Date.now(),sessionId:'debug-session',runId:'duration-debug',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      return null;
    })();

    // Try to merge with upcoming event data if available (for better participants/description)
    // Note: artifacts may not have CalendarEvent loaded; prefer recall id from CalendarEvent, fallback to artifact rawPayload.
    const recallEventIdForMerge =
      calendarEvent?.recallId ||
      artifact.recallEventId ||
      artifact.rawPayload?.data?.recall_event_id ||
      artifact.rawPayload?.data?.calendar_event_id ||
      null;
    const matchingUpcomingEvent = recallEventIdForMerge
      ? upcomingEventsByRecallId.get(recallEventIdForMerge)
      : null;
    
    // Use upcoming event title if available and better, otherwise use extracted title
    let finalTitle = extractMeetingTitle(artifact, calendarEvent);
    if (matchingUpcomingEvent?.title && !isGenericMeetingTitle(matchingUpcomingEvent.title)) {
      finalTitle = matchingUpcomingEvent.title;
    }
    
    // Use upcoming event description if available, otherwise use artifact/event description
    // #region agent log
    const artifactDesc = getDescriptionFromArtifact(artifact);
    const eventDesc = getDescriptionFromEvent(calendarEvent);
    const upcomingDesc = matchingUpcomingEvent?.description;
    // Get raw description before stripHtml for debugging
    const rawEventDesc = calendarEvent?.recallData?.raw?.body?.content || calendarEvent?.recallData?.raw?.bodyPreview || calendarEvent?.recallData?.raw?.description;
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:description_extraction',message:'Extracting description',data:{artifactId:artifact.id,title:finalTitle,rawEventDescLength:rawEventDesc?.length,rawEventDescPreview:rawEventDesc?.substring(0,200),artifactDesc:artifactDesc?.substring(0,100),eventDesc:eventDesc?.substring(0,100),upcomingDesc:upcomingDesc?.substring(0,100),hasArtifactDesc:!!artifactDesc,hasEventDesc:!!eventDesc,hasUpcomingDesc:!!upcomingDesc},timestamp:Date.now(),sessionId:'debug-session',runId:'desc-debug-v2',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    let finalDescription = artifactDesc || eventDesc;
    if (upcomingDesc) {
      finalDescription = upcomingDesc;
    }
    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:description_final',message:'Final description value',data:{artifactId:artifact.id,title:finalTitle,finalDescLength:finalDescription?.length,finalDescription:finalDescription?.substring(0,200),hasFinalDesc:!!finalDescription},timestamp:Date.now(),sessionId:'debug-session',runId:'desc-debug-v2',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
    // Merge participants from upcoming event if available (they may be more complete)
    let finalParticipants = participants;
    if (matchingUpcomingEvent?.attendees && matchingUpcomingEvent.attendees.length > 0) {
      finalParticipants = matchingUpcomingEvent.attendees;
    }

    // Note: storedMeetingUrl, metadata, and friendlyMeetingId are already declared earlier in this loop (lines 1774-1791)

    // Check if calendar has auto-recording enabled
    const calendar = calendarEvent?.Calendar;
    const hasAutoRecordEnabled = calendar ? 
      (calendar.autoRecordExternalEvents || calendar.autoRecordInternalEvents) : 
      false;

    meetingsMap.set(key, {
      id: artifact.id,
      type: "artifact",
      title: finalTitle,
      startTime,
      endTime,
      durationSeconds,
      status: artifact.status,
      hasSummary: !!summary,
      hasTranscript: hasTranscriptFlag,
      hasRecording: hasRecordingFlag,
      hasRecallRecording: hasRecallRecordingFlag,
      hasTeamsRecording: hasTeamsRecordingFlag,
      transcriptStatus: hasTranscriptFlag ? "complete" : "missing",
      summaryStatus: summary ? "complete" : "missing",
      recordingStatus: hasRecordingFlag ? "complete" : "missing",
      recordingUrl:
        artifact.rawPayload?.data?.video_url ||
        artifact.rawPayload?.data?.recording_url ||
        artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
        null,
      audioUrl:
        artifact.rawPayload?.data?.audio_url ||
        artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url ||
        null,
      teamsRecordingUrl,
      recordingSource,
      participants: finalParticipants,
      description: finalDescription,
      // #region agent log
      _debugDescription: finalDescription, // Keep for debugging
      // #endregion
      organizer: calendarEvent ? getAttendeesFromEvent(calendarEvent).find(a => a.organizer) : null,
      calendarEmail: calendarEvent?.Calendar?.email || null,
      platform: calendarEvent?.Calendar?.platform || null,
      summaryId: summary?.id || null,
      // Ownership and sharing info
      isOwner: artifact.ownerUserId === userId || artifact.userId === userId,
      isShared: sharedArtifactIds.includes(artifact.id),
      ownerUserId: artifact.ownerUserId || artifact.userId,
      meetingPlatform: artifact.meetingPlatform || metadata.meetingPlatform,
      meetingId: artifact.meetingId || metadata.meetingId,
      displayMeetingId:
        friendlyMeetingId ||
        artifact.displayMeetingId ||
        metadata.displayMeetingId,
      meetingUrl: metadata.meetingUrl,
      createdAt: artifact.createdAt,
      syncedFromApi: !!artifact.rawPayload?.synced_from_api,
      // Auto-record settings for showing video icon
      hasAutoRecordEnabled: hasAutoRecordEnabled,
    });
  }

  // Add summaries without artifacts
  for (const summary of summaries) {
    if (summary.MeetingArtifact) continue; // Already added via artifact
    
    const calendarEvent = summary.CalendarEvent;
    const key = `summary-${summary.id}`;
    const summaryTitle =
      calendarEvent?.title &&
      calendarEvent.title.trim().length > 0 &&
      !isGenericMeetingTitle(calendarEvent.title)
        ? calendarEvent.title
        : extractMeetingTitle(null, calendarEvent);
    const summaryParticipants = calendarEvent ? getAttendeesFromEvent(calendarEvent) : [];

    const metadata = extractMeetingMetadata({
      meetingUrl: calendarEvent?.meetingUrl,
    });
    const friendlyMeetingId = deriveFriendlyMeetingId({
      metadataMeetingId: metadata.meetingId,
      metadataDisplayId: metadata.displayMeetingId,
      calendarEvent,
      extraMeetingIds: [
        calendarEvent?.recallData?.raw?.onlineMeeting?.meetingId,
      ],
    });

    // Check if calendar has auto-recording enabled
    const summaryCalendar = calendarEvent?.Calendar;
    const summaryHasAutoRecordEnabled = summaryCalendar ? 
      (summaryCalendar.autoRecordExternalEvents || summaryCalendar.autoRecordInternalEvents) : 
      false;

    meetingsMap.set(key, {
      id: summary.id,
      type: "summary",
      title: summaryTitle,
      startTime: calendarEvent?.startTime || summary.createdAt,
      endTime: calendarEvent?.endTime || null,
      durationSeconds:
        calendarEvent?.startTime && calendarEvent?.endTime
          ? Math.max(0, (new Date(calendarEvent.endTime) - new Date(calendarEvent.startTime)) / 1000)
          : null,
      status: summary.status,
      hasSummary: true,
      hasTranscript: false,
      hasRecording: false,
      hasRecallRecording: false,
      hasTeamsRecording: false,
      transcriptStatus: "missing",
      summaryStatus: "complete",
      recordingStatus: "missing",
      recordingUrl: null,
      audioUrl: null,
      teamsRecordingUrl: null,
      recordingSource: null,
      participants: summaryParticipants,
      description: getDescriptionFromEvent(calendarEvent),
      organizer: calendarEvent ? getAttendeesFromEvent(calendarEvent).find(a => a.organizer) : null,
      calendarEmail: calendarEvent?.Calendar?.email || null,
      platform: calendarEvent?.platform || null,
      meetingPlatform: metadata.meetingPlatform,
      meetingId: metadata.meetingId,
      displayMeetingId: friendlyMeetingId || metadata.displayMeetingId,
      meetingUrl: metadata.meetingUrl,
      summaryId: summary.id,
      createdAt: summary.createdAt,
      // Auto-record settings for showing video icon
      hasAutoRecordEnabled: summaryHasAutoRecordEnabled,
    });
  }

  // Apply filters & search
  let meetings = Array.from(meetingsMap.values());

  if (hasTranscriptFilter !== null) {
    meetings = meetings.filter((m) => m.hasTranscript === hasTranscriptFilter);
  }
  if (hasSummaryFilter !== null) {
    meetings = meetings.filter((m) => m.hasSummary === hasSummaryFilter);
  }
  if (hasRecordingFilter !== null) {
    meetings = meetings.filter((m) => m.hasRecording === hasRecordingFilter);
  }
  // Filter to exclude meetings without Recall recordings (but allow platform recordings)
  if (hasRecallRecordingFilter === true) {
    meetings = meetings.filter((m) => m.hasRecallRecording === true);
  } else if (hasRecallRecordingFilter === false) {
    // If explicitly set to false, show only meetings without Recall recordings
    meetings = meetings.filter((m) => m.hasRecallRecording !== true);
  }
  if (hasTeamsRecordingFilter !== null) {
    meetings = meetings.filter((m) => m.hasTeamsRecording === hasTeamsRecordingFilter);
  }
  if (q && q.trim().length > 0) {
    const qLower = q.trim().toLowerCase();
    meetings = meetings.filter((m) => {
      const titleMatch = (m.title || "").toLowerCase().includes(qLower);
      const participantsMatch = (m.participants || []).some((p) =>
        (p.name || p.email || "").toLowerCase().includes(qLower)
      );
      return titleMatch || participantsMatch;
    });
  }

  // Sorting
  // #region agent log
  // H1/H2/H3/H6: Log all meetings before sorting to see if today's meetings exist and their dates
  // Use UTC-based "today" calculation to avoid timezone issues
  const nowForSort = new Date();
  const todayStart = new Date(Date.UTC(nowForSort.getUTCFullYear(), nowForSort.getUTCMonth(), nowForSort.getUTCDate(), 0, 0, 0, 0));
  const todayEnd = new Date(Date.UTC(nowForSort.getUTCFullYear(), nowForSort.getUTCMonth(), nowForSort.getUTCDate(), 23, 59, 59, 999));
  const todaysMeetings = meetings.filter(m => {
    const mDate = new Date(m.startTime || m.createdAt);
    return mDate >= todayStart && mDate <= todayEnd;
  });
  // Also check meetings from the last 48 hours to catch timezone edge cases
  const last48Hours = new Date(nowForSort.getTime() - 48 * 60 * 60 * 1000);
  const recentMeetingsLast48h = meetings.filter(m => {
    const mDate = new Date(m.startTime || m.createdAt);
    return mDate >= last48Hours;
  });
  const recentMeetings = meetings.slice(0, 10).map(m => ({
    id: m.id,
    title: m.title?.substring(0, 30),
    startTime: m.startTime,
    createdAt: m.createdAt,
    type: m.type,
    hasCalendarEvent: !!m.calendarEventId,
  }));
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'list.js:H1-H3-H6',message:'before_sort',data:{totalMeetings:meetings.length,todaysMeetingsCount:todaysMeetings.length,last48hMeetingsCount:recentMeetingsLast48h.length,todaysMeetings:todaysMeetings.map(m=>({id:m.id,title:m.title?.substring(0,30),startTime:m.startTime,createdAt:m.createdAt})),first10Meetings:recentMeetings,todayStartUTC:todayStart.toISOString(),todayEndUTC:todayEnd.toISOString(),nowUTC:nowForSort.toISOString()},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-H3-H6'})}).catch(()=>{});
  // #endregion
  
  meetings.sort((a, b) => {
    if (sort === "oldest") {
      return new Date(a.startTime || a.createdAt) - new Date(b.startTime || b.createdAt);
    }
    if (sort === "duration") {
      return (b.durationSeconds || 0) - (a.durationSeconds || 0);
    }
    // default newest
    return new Date(b.startTime || b.createdAt) - new Date(a.startTime || a.createdAt);
  });

  // #region agent log
  // H3/H5: Log meetings after sorting to see order
  const sortedFirst10 = meetings.slice(0, 10).map(m => ({
    id: m.id,
    title: m.title?.substring(0, 30),
    startTime: m.startTime,
    createdAt: m.createdAt,
    sortKey: new Date(m.startTime || m.createdAt).toISOString(),
  }));
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'list.js:H3-H5',message:'after_sort',data:{sortedFirst10,sortParam:sort,totalMeetings:meetings.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3-H5'})}).catch(()=>{});
  // #endregion

  // Pagination: Calculate totals and slice after filtering/sorting
  const totalCount = meetings.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasNext = page < totalPages;
  const hasPrev = page > 1;
  const paginatedMeetings = meetings.slice(offset, offset + PAGE_SIZE);
  
  // Calculate total time for all meetings (in seconds)
  const totalTimeSeconds = meetings.reduce((sum, m) => {
    return sum + (m.durationSeconds || 0);
  }, 0);
  
  // Format total time
  const totalHours = Math.floor(totalTimeSeconds / 3600);
  const totalMinutes = Math.floor((totalTimeSeconds % 3600) / 60);
  const totalTimeFormatted = totalHours > 0 
    ? `${totalHours}h ${totalMinutes}m`
    : `${totalMinutes}m`;

  // #region agent log
  const totalTime = Date.now() - perfStart;
  fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/meetings/list.js:performance',message:'Page render time (background sync)',data:{totalTimeMs:totalTime,syncSkipped:!shouldSync||syncInProgress,lastSyncAge,syncInProgress,calendarsCount:calendars.length,artifactsCount:artifacts.length,meetingsCount:meetings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'perf-bg-1'})}).catch(()=>{});
  // #endregion

  console.log(`[MEETINGS-DEBUG] Rendering meetings page in ${totalTime}ms:`, {
    userId,
    calendarsCount: calendars.length,
    hasCalendars: calendars.length > 0,
    artifactsCount: artifacts.length,
    summariesCount: summaries.length,
    meetingsCount: meetings.length,
    upcomingEventsCount: upcomingEvents.length,
    meetingsSample: meetings.slice(0, 3).map(m => ({ id: m.id, title: m.title, type: m.type })),
    page,
    totalPages,
    syncSkipped: !shouldSync || syncInProgress,
  });

  // Helper function to build pagination URL with filters preserved
  const buildPaginationUrl = (pageNum) => {
    const params = new URLSearchParams();
    params.set('page', String(pageNum));
    if (q) params.set('q', q);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (hasTranscriptFilter !== null) params.set('hasTranscript', String(hasTranscriptFilter));
    if (hasSummaryFilter !== null) params.set('hasSummary', String(hasSummaryFilter));
    if (hasRecordingFilter !== null) params.set('hasRecording', String(hasRecordingFilter));
    if (hasRecallRecordingFilter !== null) params.set('hasRecallRecording', String(hasRecallRecordingFilter));
    if (hasTeamsRecordingFilter !== null) params.set('hasTeamsRecording', String(hasTeamsRecordingFilter));
    if (sort) params.set('sort', sort);
    return `/meetings?${params.toString()}#past`;
  };

  // Build pagination URLs for all pages (for template rendering)
  const paginationUrls = {};
  for (let p = 1; p <= totalPages; p++) {
    paginationUrls[p] = buildPaginationUrl(p);
  }
  
  return res.render("meetings.ejs", {
    notice: req.notice,
    user: req.authentication.user,
    meetings: paginatedMeetings,
    upcomingEvents,
    hasCalendars: calendars.length > 0,
    page,
    totalPages,
    totalCount, // Total number of meetings after filtering
    hasNext,
    hasPrev,
    totalTimeSeconds,
    totalTimeFormatted,
    lastSyncAge, // seconds since last sync, or null if never synced
    syncInProgress, // true if background sync is running
    filters: {
      q: q || "",
      from: from || "",
      to: to || "",
      hasTranscript: hasTranscriptFilter,
      hasSummary: hasSummaryFilter,
      hasRecording: hasRecordingFilter,
      hasRecallRecording: hasRecallRecordingFilter,
      hasTeamsRecording: hasTeamsRecordingFilter,
      sort: sort || "newest",
    },
    upcomingFilters: {
      q: upcomingQFilter,
      from: upcomingFromFilter,
      to: upcomingToFilter,
      hasMeetingUrl: upcomingHasMeetingUrlFilter,
      hasBot: upcomingHasBotFilter,
      hasRecording: upcomingHasRecordingFilter,
      sort: upcomingSortFilter,
    },
    paginationUrls, // Pre-built pagination URLs for all pages
    prevPageUrl: hasPrev ? buildPaginationUrl(page - 1) : null,
    nextPageUrl: hasNext ? buildPaginationUrl(page + 1) : null,
  });
};

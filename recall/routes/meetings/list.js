import db from "../../db.js";
import { Op } from "sequelize";
import Recall from "../../services/recall/index.js";
import { backgroundQueue } from "../../queue.js";
import { telemetryEvent } from "../../utils/telemetry.js";
import { generateUniqueReadableMeetingId } from "../../utils/meeting-id.js";
import { v4 as uuidv4 } from "uuid";
import {
  extractMeetingMetadata,
  normalizeMeetingUrl as normalizeMeetingUrlUtil,
} from "../../utils/meeting-metadata-extractor.js";
const { sequelize } = db;

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
// Key: `sync-${userId}`, Value: { lastSyncTime: Date, inProgress: boolean }
const syncCache = new Map();
const SYNC_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes - only sync if last sync was > 5 min ago

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
    
    console.log(`[MEETINGS] Bot ${bot.id}: statusCode=${statusCode}, lastStatus=${lastStatus}, isComplete=${isComplete}`);
    return isComplete;
  });
  
  console.log(`[MEETINGS] Found ${completedBots.length} completed bots (processing max ${fetchLimit})`);
  // Process up to fetchLimit bots (which may be higher than MAX_COMPLETED_BOTS in backfill mode)
  const botsToProcess = completedBots.slice(0, fetchLimit);
  
  // Get calendar recallIds for matching
  const calendarRecallIds = calendars.map(c => c.recallId);
  
  for (const bot of botsToProcess) {
    const botId = bot.id;
    const botStatus = bot.status?.code || bot.status;
    
    // Check if we already have an artifact for this bot
    const existingArtifact = await db.MeetingArtifact.findOne({
      where: { recallBotId: botId },
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
    // Fetch events updated in the last 24 hours OR events in the future (up to 1 year ahead)
    // This ensures we sync both recent changes and upcoming meetings
    const lastUpdatedTimestamp = new Date();
    lastUpdatedTimestamp.setHours(lastUpdatedTimestamp.getHours() - 24);
    
    // Also fetch future events (up to 1 year ahead) to ensure upcoming meetings are synced
    const futureCutoff = new Date();
    futureCutoff.setFullYear(futureCutoff.getFullYear() + 1);
    
    console.log(`[MEETINGS] On-demand sync for calendar ${calendar.id} (${calendar.email})`);
    
    // Fetch events updated recently OR events in the future
    const events = await Recall.fetchCalendarEvents({
      id: calendar.recallId,
      lastUpdatedTimestamp: lastUpdatedTimestamp.toISOString(),
      // Note: The Recall API may not support future date filtering directly,
      // but we'll filter in memory after fetching
    });
    
    // Filter to include: events updated in last 24h OR events in the future
    const now = new Date();
    const relevantEvents = events.filter(event => {
      if (event["is_deleted"]) return false;
      
      // Include if updated recently
      const updatedAt = event.updated_at || event.updatedAt || event.created_at || event.createdAt;
      if (updatedAt) {
        const updatedDate = new Date(updatedAt);
        if (updatedDate > lastUpdatedTimestamp) return true;
      }
      
      // Include if it's a future event (up to 1 year ahead)
      const startTime = event.start_time || event.startTime || event.start;
      if (startTime) {
        const startDate = new Date(startTime);
        if (startDate > now && startDate <= futureCutoff) return true;
      }
      
      return false;
    });

    let newEventsCount = 0;
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
      }
    }

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
      const queuePromises = eventsToSchedule.map(event => 
        backgroundQueue.add("calendarevent.update_bot_schedule", {
          calendarId: calendar.id,
          recallEventId: event.recallId,
        }).then(() => {
        }).catch(err => {
          console.warn(`[MEETINGS] Queue add failed (Redis unavailable?):`, err.message);
        })
      );
      // Don't await - let these run in background
      Promise.allSettled(queuePromises).catch(() => {});
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
  const upcomingSortFilter = upcomingSort || "newest";
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

  // On-demand sync: fetch latest events from Recall.ai
  // OPTIMIZATION: Run sync in BACKGROUND (non-blocking) to return page instantly
  // Data will be fresh on next page load; user can also click "Refresh" button
  const syncCacheKey = `sync-${userId}`;
  const cachedSync = syncCache.get(syncCacheKey);
  const now = Date.now();
  const shouldSync = !cachedSync || (now - cachedSync.lastSyncTime > SYNC_THROTTLE_MS);
  const syncInProgress = cachedSync?.inProgress || false;
  
  // Track sync status for UI
  let lastSyncAge = cachedSync ? Math.round((now - cachedSync.lastSyncTime) / 1000) : null;
  
  if (calendars.length > 0 && shouldSync && !syncInProgress) {
    // Mark sync as in progress to prevent concurrent syncs
    syncCache.set(syncCacheKey, { lastSyncTime: now, inProgress: true });
    
    // Run sync in background - DON'T await, let page render immediately
    (async () => {
      try {
        const syncStartTime = Date.now();
        await Promise.all(calendars.map(cal => syncCalendarEvents(cal)));
        console.log(`[MEETINGS] Background sync completed in ${Date.now() - syncStartTime}ms`);
        
        const botSyncStartTime = Date.now();
        await syncBotArtifacts(calendars, userId);
        console.log(`[MEETINGS] Background bot sync completed in ${Date.now() - botSyncStartTime}ms`);
        
        syncCache.set(syncCacheKey, { lastSyncTime: Date.now(), inProgress: false });
      } catch (err) {
        console.error(`[MEETINGS] Background sync error:`, err);
        syncCache.set(syncCacheKey, { lastSyncTime: now, inProgress: false });
      }
    })();
    
    console.log(`[MEETINGS] Background sync started (non-blocking)`);
  } else if (calendars.length > 0) {
    console.log(`[MEETINGS] Skipping sync - last sync was ${lastSyncAge}s ago, inProgress=${syncInProgress}`);
  }

  // Get upcoming events from all calendars (future events only)
  const nowDate = new Date();
  const upcomingEvents = [];
  
  if (calendars.length > 0) {
    const calendarIds = calendars.map(c => c.id);
    
    // Get future events - query with a reasonable future date range (up to 2 years ahead)
    // This ensures we capture all upcoming meetings, even those scheduled far in advance
    const futureCutoff = new Date();
    futureCutoff.setFullYear(futureCutoff.getFullYear() + 2); // Look up to 2 years ahead
    
    let allEvents = [];
    try {
      // Fetch events and filter by startTime in the database if possible, otherwise filter in memory
      // We'll fetch more events to ensure we don't miss any future meetings
      allEvents = await db.CalendarEvent.findAll({
        where: {
          calendarId: { [Op.in]: calendarIds },
          // Try to filter by startTime in database, but fallback to memory filtering if it fails
          startTime: {
            [Op.gte]: nowDate,
            [Op.lte]: futureCutoff,
          },
        },
        include: [{ model: db.Calendar }],
        order: [['startTime', 'ASC']], // Order by startTime ascending to get nearest future events first
        limit: 500, // Increased limit to ensure we get all future events
      });
      
      // If database filtering failed (e.g., startTime is stored as string), filter in memory
      if (allEvents.length === 0 || allEvents.some(e => !e.startTime || new Date(e.startTime) <= nowDate)) {
        console.log(`[MEETINGS] Database filtering may have failed, fetching all events and filtering in memory`);
        const allEventsUnfiltered = await db.CalendarEvent.findAll({
          where: {
            calendarId: { [Op.in]: calendarIds },
          },
          include: [{ model: db.Calendar }],
          order: [['startTime', 'ASC']],
          limit: 1000, // Fetch more to ensure we get future events
        });
        
        // Filter to future events in memory
        allEvents = allEventsUnfiltered.filter(event => {
          try {
            const startTime = event.startTime;
            if (!startTime) return false;
            const startDate = new Date(startTime);
            return startDate > nowDate && startDate <= futureCutoff;
          } catch (error) {
            console.error(`[MEETINGS] Error parsing start time for event ${event.id}:`, error);
            return false;
          }
        });
      }
    } catch (error) {
      console.error(`[MEETINGS] Error fetching calendar events:`, error);
      // Fallback: try without date filtering
      try {
        const allEventsUnfiltered = await db.CalendarEvent.findAll({
          where: {
            calendarId: { [Op.in]: calendarIds },
          },
          include: [{ model: db.Calendar }],
          order: [['startTime', 'ASC']],
          limit: 1000,
        });
        
        // Filter to future events in memory
        allEvents = allEventsUnfiltered.filter(event => {
          try {
            const startTime = event.startTime;
            return startTime && new Date(startTime) > nowDate && new Date(startTime) <= futureCutoff;
          } catch (error) {
            console.error(`[MEETINGS] Error parsing start time for event ${event.id}:`, error);
            return false;
          }
        });
      } catch (fallbackError) {
        console.error(`[MEETINGS] Fallback query also failed:`, fallbackError);
        allEvents = [];
      }
    }
    
    // Filter to future events (already filtered above, but ensure we have the right data)
    const futureEvents = allEvents.filter(event => {
      try {
        const startTime = event.startTime;
        if (!startTime) return false;
        const startDate = new Date(startTime);
        return startDate > nowDate && startDate <= futureCutoff;
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
      if (upcomingSortFilter === "oldest") {
        return new Date(a.startTime || 0) - new Date(b.startTime || 0);
      }
      // default newest (most recent first)
      return new Date(b.startTime || 0) - new Date(a.startTime || 0);
    });

    // Update upcomingEvents with filtered results
    upcomingEvents.length = 0;
    upcomingEvents.push(...filteredUpcomingEvents);
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

  // Add artifacts
  for (const artifact of artifacts) {
    const key = artifact.id;
    
    // Try to find matching calendar event by thread_id from meeting URL
    const artifactThreadId = extractThreadId(artifact.rawPayload?.data?.meeting_url);
    const calendarEvent =
      artifact.CalendarEvent ||
      (artifactThreadId ? calendarEventsByThreadId.get(artifactThreadId) : null);
    const summary = artifact.MeetingSummaries?.[0] || artifact.MeetingSummary || null;

    // Prioritize artifact data for start/end times
    const artifactStartTime = artifact.rawPayload?.data?.start_time;
    const artifactEndTime = artifact.rawPayload?.data?.end_time;
    const startTime = artifactStartTime || calendarEvent?.startTime || artifact.createdAt;
    const endTime = artifactEndTime || calendarEvent?.endTime || null;

    const participants = getParticipantsForMeeting(artifact, calendarEvent);
    const hasTranscriptFromPayload = hasTranscriptContent(artifact.rawPayload?.data?.transcript);
    // Use the pre-computed chunk count instead of loading all chunks
    const hasTranscriptFromChunks = artifact.hasTranscriptChunks || false;
    const hasTranscriptFlag = hasTranscriptFromPayload || hasTranscriptFromChunks;

    const hasRecordingFlag = !!(
      artifact.rawPayload?.data?.video_url ||
      artifact.rawPayload?.data?.recording_url ||
      artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url
    );
    
    // Check if this is a Recall recording (has artifact with recording) vs platform recording
    const hasRecallRecordingFlag = hasRecordingFlag && !!artifact.recallBotId;

    // Check if this is a Teams recording
    const hasTeamsRecordingFlag = 
      artifact.eventType === "teams_recording" ||
      artifact.rawPayload?.source === "microsoft_teams" ||
      (typeof artifact.rawPayload?.data?.meetingUrl === "string" && 
       artifact.rawPayload.data.meetingUrl.includes("teams.microsoft.com")) ||
      (calendarEvent?.meetingUrl && calendarEvent.meetingUrl.includes("teams.microsoft.com"));

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

import db from "../../db.js";
import { Op } from "sequelize";
import Recall from "../../services/recall/index.js";
import { backgroundQueue } from "../../queue.js";
import { telemetryEvent } from "../../utils/telemetry.js";
const { sequelize } = db;

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
 * Extract description from a calendar event
 */
function getDescriptionFromEvent(event) {
  if (!event) return null;
  const raw = event?.recallData?.raw || {};
  
  if (event.platform === "google_calendar") {
    return raw["description"] || null;
  } else if (event.platform === "microsoft_outlook") {
    return raw["body"]?.content || raw["bodyPreview"] || null;
  }
  
  return null;
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
  const MAX_COMPLETED_BOTS = 20; // avoid OOM by capping fetches per sync
  // List recent bots directly from Recall API
  let bots = [];
  try {
    console.log(`[MEETINGS] Fetching bots from Recall API...`);
    bots = await Recall.listBots({ limit: 50 });
    console.log(`[MEETINGS] Found ${bots.length} bots from Recall API`);
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
  
  console.log(`[MEETINGS] Found ${completedBots.length} completed bots (processing max ${MAX_COMPLETED_BOTS})`);
  const botsToProcess = completedBots.slice(0, MAX_COMPLETED_BOTS);
  
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

      const artifact = await db.MeetingArtifact.create({
        recallEventId: calendarEvent?.recallId || null,
        recallBotId: botId,
        calendarEventId: calendarEvent?.id || null,
        userId: userId,
        eventType: 'bot.done',
        status: 'done',
        rawPayload: {
          event: 'bot.done',
          data: {
            bot_id: botId,
            calendar_event_id: calendarEvent?.recallId || null,
            title: computedTitle,
            start_time: bot.join_at || bot.created_at,
            end_time: bot.updated_at,
            meeting_url: bot.meeting_url,
            video_url: bot.video_url || null,
            audio_url: bot.audio_url || null,
            recording_url: bot.video_url || null,
            transcript: transcript,
            status: botStatus,
            participants: bot.meeting_participants || [],
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
    const lastUpdatedTimestamp = new Date();
    lastUpdatedTimestamp.setHours(lastUpdatedTimestamp.getHours() - 24);
    
    console.log(`[MEETINGS] On-demand sync for calendar ${calendar.id} (${calendar.email})`);
    
    const events = await Recall.fetchCalendarEvents({
      id: calendar.recallId,
      lastUpdatedTimestamp: lastUpdatedTimestamp.toISOString(),
    });

    let newEventsCount = 0;
    for (const event of events) {
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
    if (events.length > 0) {
      console.log(`[MEETINGS] On-demand sync processing ${events.length} event(s) for calendar ${calendar.id} (${newEventsCount} new)`);
      const { updateAutoRecordStatusForCalendarEvents } = await import("../../logic/autorecord.js");
      const dbEvents = await db.CalendarEvent.findAll({
        where: {
          recallId: { [Op.in]: events.filter(e => !e.is_deleted).map(e => e.id) },
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

    return events.length;
  } catch (error) {
    console.error(`[MEETINGS] On-demand sync failed for calendar ${calendar.id}:`, error.message);
    return 0;
  }
}

export default async (req, res) => {
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
    sort,
  } = req.query;

  const hasTranscriptFilter = hasTranscript === "true" ? true : hasTranscript === "false" ? false : null;
  const hasSummaryFilter = hasSummary === "true" ? true : hasSummary === "false" ? false : null;
  const hasRecordingFilter = hasRecording === "true" ? true : hasRecording === "false" ? false : null;
  const hasRecallRecordingFilter = hasRecallRecording === "true" ? true : hasRecallRecording === "false" ? false : null;

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

  // On-demand sync: fetch latest events from Recall.ai before showing meetings
  // This ensures we have fresh data even if webhooks are delayed/dropped
  if (calendars.length > 0) {
    const syncStartTime = Date.now();
    await Promise.all(calendars.map(cal => syncCalendarEvents(cal)));
    console.log(`[MEETINGS] On-demand sync completed in ${Date.now() - syncStartTime}ms`);
    
    // Sync bot artifacts for past events (fallback for missing webhooks)
    const botSyncStartTime = Date.now();
    await syncBotArtifacts(calendars, userId);
    console.log(`[MEETINGS] Bot artifact sync completed in ${Date.now() - botSyncStartTime}ms`);
  }

  // Get upcoming events from all calendars (future events only)
  const now = new Date();
  const upcomingEvents = [];
  
  if (calendars.length > 0) {
    const calendarIds = calendars.map(c => c.id);
    
    // Get all events first, then filter by start time in JavaScript
    // This avoids complex SQL casting that might fail
    let allEvents = [];
    try {
      allEvents = await db.CalendarEvent.findAll({
        where: {
          calendarId: { [Op.in]: calendarIds },
        },
        include: [{ model: db.Calendar }],
        limit: 200, // Get more events to filter in memory
      });
    } catch (error) {
      console.error(`[MEETINGS] Error fetching calendar events:`, error);
      // Continue with empty events array
    }
    
    // Filter to future events
    const futureEvents = allEvents.filter(event => {
      try {
        const startTime = event.startTime;
        return startTime && new Date(startTime) > now;
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
      });
    }
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
  let artifacts = [];
  try {
    const artifactResult = await db.MeetingArtifact.findAndCountAll({
      where: { userId },
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
        {
          model: db.MeetingTranscriptChunk,
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: PAGE_SIZE,
      offset,
    });
    artifacts = artifactResult.rows;
  } catch (error) {
    console.error(`[MEETINGS] Error fetching meeting artifacts:`, error);
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

  // Add artifacts
  for (const artifact of artifacts) {
    const key = artifact.id;
    const calendarEvent = artifact.CalendarEvent;
    const summary = artifact.MeetingSummaries?.[0] || artifact.MeetingSummary || null;

    const startTime = calendarEvent?.startTime || artifact.rawPayload?.data?.start_time || artifact.createdAt;
    const endTime = calendarEvent?.endTime || artifact.rawPayload?.data?.end_time || null;

    const participants = getParticipantsForMeeting(artifact, calendarEvent);
    const hasTranscriptFromPayload = hasTranscriptContent(artifact.rawPayload?.data?.transcript);
    const hasTranscriptFromChunks =
      Array.isArray(artifact.MeetingTranscriptChunks) && artifact.MeetingTranscriptChunks.length > 0;
    const hasTranscriptFlag = hasTranscriptFromPayload || hasTranscriptFromChunks;

    const hasRecordingFlag = !!(
      artifact.rawPayload?.data?.video_url ||
      artifact.rawPayload?.data?.recording_url ||
      artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url
    );
    
    // Check if this is a Recall recording (has artifact with recording) vs platform recording
    const hasRecallRecordingFlag = hasRecordingFlag && !!artifact.recallBotId;

    const durationSeconds =
      startTime && endTime
        ? Math.max(0, (new Date(endTime) - new Date(startTime)) / 1000)
        : (() => {
            // Fallback: derive from transcript chunks if available
            if (hasTranscriptFromChunks) {
              const times = artifact.MeetingTranscriptChunks.map((c) => c.endTimeMs || c.startTimeMs || 0);
              const maxMs = Math.max(...times, 0);
              if (maxMs > 0) return Math.round(maxMs / 1000);
            }
            // Fallback: use bot timestamps from raw payload if present
            const rawEnd = artifact.rawPayload?.data?.end_time;
            const rawStart = artifact.rawPayload?.data?.start_time;
            if (rawStart && rawEnd) {
              return Math.max(0, (new Date(rawEnd) - new Date(rawStart)) / 1000);
            }
            return null;
          })();

    meetingsMap.set(key, {
      id: artifact.id,
      type: "artifact",
      title: extractMeetingTitle(artifact, calendarEvent),
      startTime,
      endTime,
      durationSeconds,
      status: artifact.status,
      hasSummary: !!summary,
      hasTranscript: hasTranscriptFlag,
      hasRecording: hasRecordingFlag,
      hasRecallRecording: hasRecallRecordingFlag,
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
      participants,
      description: getDescriptionFromEvent(calendarEvent),
      organizer: calendarEvent ? getAttendeesFromEvent(calendarEvent).find(a => a.organizer) : null,
      calendarEmail: calendarEvent?.Calendar?.email || null,
      platform: calendarEvent?.Calendar?.platform || null,
      summaryId: summary?.id || null,
      meetingUrl: normalizeMeetingUrl(
        calendarEvent?.meetingUrl || artifact.rawPayload?.data?.meeting_url || null
      ),
      createdAt: artifact.createdAt,
      syncedFromApi: !!artifact.rawPayload?.synced_from_api,
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
      meetingUrl: normalizeMeetingUrl(calendarEvent?.meetingUrl || null),
      summaryId: summary.id,
      createdAt: summary.createdAt,
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

  console.log(`[MEETINGS-DEBUG] Rendering meetings page:`, {
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
  });

  
  return res.render("meetings.ejs", {
    notice: req.notice,
    user: req.authentication.user,
    meetings: paginatedMeetings,
    upcomingEvents,
    hasCalendars: calendars.length > 0,
    page,
    totalPages,
    hasNext,
    hasPrev,
    totalTimeSeconds,
    totalTimeFormatted,
    filters: {
      q: q || "",
      from: from || "",
      to: to || "",
      hasTranscript: hasTranscriptFilter,
      hasSummary: hasSummaryFilter,
      hasRecording: hasRecordingFilter,
      hasRecallRecording: hasRecallRecordingFilter,
      sort: sort || "newest",
    },
  });
};

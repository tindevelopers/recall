import { getClient } from "./api-client.js";
import { telemetryEvent } from "../../utils/telemetry.js";

function extractRecordingUrls(bot = {}) {
  const result = { videoUrl: null, audioUrl: null, transcriptUrl: null };

  const recordings = bot.recordings || bot?.outputs?.recordings || [];
  const recordingList = Array.isArray(recordings) ? recordings : [];

  // Prefer completed recordings first
  const preferredRecordings =
    recordingList.filter(
      (r) =>
        r?.status?.code === "done" ||
        r?.status_code === "done" ||
        r?.status === "done"
    ) || [];
  const candidates =
    preferredRecordings.length > 0 ? preferredRecordings : recordingList;

  const pickFromRecording = (recording = {}) => {
    const shortcuts = recording.media_shortcuts || {};
    const videoMixed = shortcuts.video_mixed?.data?.download_url;
    const audioMixed = shortcuts.audio_mixed?.data?.download_url;
    const video = shortcuts.video?.data?.download_url;
    const audio = shortcuts.audio?.data?.download_url;
    const transcript = shortcuts.transcript?.data?.download_url;

    return {
      videoUrl:
        videoMixed ||
        video ||
        recording.video_url ||
        recording.recording_url ||
        null,
      audioUrl: audioMixed || audio || recording.audio_url || null,
      transcriptUrl: transcript || recording.transcript_url || null,
    };
  };

  for (const recording of candidates) {
    if (result.videoUrl && result.audioUrl && result.transcriptUrl) break;
    const picked = pickFromRecording(recording);
    if (!result.videoUrl && picked.videoUrl) result.videoUrl = picked.videoUrl;
    if (!result.audioUrl && picked.audioUrl) result.audioUrl = picked.audioUrl;
    if (!result.transcriptUrl && picked.transcriptUrl)
      result.transcriptUrl = picked.transcriptUrl;
  }

  // Fallbacks on bot-level media_shortcuts/outputs
  if (!result.videoUrl) {
    result.videoUrl =
      bot?.media_shortcuts?.video_mixed?.data?.download_url ||
      bot?.media_shortcuts?.video?.data?.download_url ||
      bot?.outputs?.video?.download_url ||
      bot?.recording_url ||
      bot?.video_url ||
      null;
  }
  if (!result.audioUrl) {
    result.audioUrl =
      bot?.media_shortcuts?.audio_mixed?.data?.download_url ||
      bot?.media_shortcuts?.audio?.data?.download_url ||
      bot?.outputs?.audio?.download_url ||
      bot?.audio_url ||
      null;
  }
  if (!result.transcriptUrl) {
    result.transcriptUrl =
      bot?.media_shortcuts?.transcript?.data?.download_url ||
      bot?.transcript_url ||
      bot?.outputs?.transcript?.download_url ||
      null;
  }

  return result;
}

let client = null;
const recallService = {
  initialize() {
    client = getClient();
  },
  
  createCalendar: async (data) => {
    return await client.request({
      path: "/api/v2/calendars/",
      method: "POST",
      data,
    });
  },
  getCalendar: async (id) => {
    return await client.request({
      path: `/api/v2/calendars/${id}/`,
      method: "GET",
    });
  },
  updateCalendar: async ({ id, data }) => {
    return await client.request({
      path: `/api/v2/calendars/${id}/`,
      method: "PATCH",
      data,
    });
  },
  deleteCalendar: async (id) => {
    return await client.request({
      path: `/api/v2/calendars/${id}/`,
      method: "DELETE",
    });
  },
  fetchCalendarEvents: async ({ id, lastUpdatedTimestamp }) => {
    let events = [];
    let pageUrl = client.buildUrl("/api/v2/calendar-events/", {
      calendar_id: id,
      updated_at__gte: lastUpdatedTimestamp,
    });

    while (true) {
      let { results, next } = await client.request({
        url: pageUrl,
        method: "GET",
      });
      events = events.concat(results);
      if (!next) {
        break;
      }

      // Recall API returns http:// urls when developing locally, but we need https:// urls
      if (next.indexOf("https:") === -1 && pageUrl.indexOf("https:") !== -1) {
        next = next.replace("http:", "https:");
      }
      
      pageUrl = next;
    }
    return events;
  },
  
  addBotToCalendarEvent: async ({ id, deduplicationKey, botConfig }) => {
    await telemetryEvent(
      "Recall.addBotToCalendarEvent.request",
      {
        calendarEventId: id,
        deduplicationKey,
        hasJoinAt: !!botConfig?.join_at,
      },
      { location: "services/recall/index.js:addBotToCalendarEvent" }
    );
    
    try {
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/recall/index.js:api_request_start',message:'Starting Recall API request to schedule bot',data:{calendarEventId:id,deduplicationKey:deduplicationKey,botConfigKeys:Object.keys(botConfig||{}),hasJoinAt:!!botConfig?.join_at,hasRecordingConfig:!!botConfig?.recording_config,hasStatusCallback:!!botConfig?.status_callback_url},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      const result = await client.request({
        path: `/api/v2/calendar-events/${id}/bot/`,
        method: "POST",
        data: {
          deduplication_key: deduplicationKey,
          bot_config: botConfig,
        },
      });

      const botIds = Array.isArray(result?.bots)
        ? result.bots.map((b) => b?.id).filter(Boolean)
        : [];

      // #region agent log
      // Capture bot details from response to check if config was applied
      const botDetails = Array.isArray(result?.bots) ? result.bots.map(b => ({
        id: b?.id,
        status: b?.status,
        bot_name: b?.bot_name,
        join_at: b?.join_at,
        hasRecordingConfig: !!b?.recording_config,
        hasTranscript: !!b?.recording_config?.transcript,
      })) : [];
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/recall/index.js:api_request_success',message:'Recall API request succeeded',data:{calendarEventId:id,hasResult:!!result,resultKeys:result?Object.keys(result):[],botCount:botIds.length,botIds:botIds,botDetails:botDetails,resultPreview:JSON.stringify(result).substring(0,1500)},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-change',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      await telemetryEvent(
        "Recall.addBotToCalendarEvent.success",
        {
          calendarEventId: id,
          resultKeys: Object.keys(result || {}),
          botIds,
          botCount: botIds.length,
        },
        { location: "services/recall/index.js:addBotToCalendarEvent" }
      );

      return result;
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/recall/index.js:api_request_failed',message:'Recall API request failed',data:{calendarEventId:id,errorMessage:err?.message,errorStatus:err?.res?.status,hasErrorBody:!!err?.body,errorBodyPreview:err?.body?.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      await telemetryEvent(
        "Recall.addBotToCalendarEvent.failure",
        {
          calendarEventId: id,
          errorMessage: err?.message,
          status: err?.res?.status,
        },
        { location: "services/recall/index.js:addBotToCalendarEvent" }
      );
      throw err;
    }
  },
  removeBotFromCalendarEvent: async ({ id }) => {
    return await client.request({
      path: `/api/v2/calendar-events/${id}/bot/`,
      method: "DELETE",
    });
  },

  /** GET a single calendar event by id (used by shared-bot scheduling to check .bots). */
  getCalendarEvent: async (eventId) => {
    return await client.request({
      path: `/api/v2/calendar-events/${eventId}/`,
      method: "GET",
    });
  },
  
  // Bot and Notepad API methods
  getBotV1: async (botId) => {
    return await client.request({
      path: `/api/v1/bot/${botId}/`,
      method: "GET",
    });
  },

  listRecordingsV1: async ({ botId, statusCode = "done" } = {}) => {
    return await client.request({
      path: `/api/v1/recording/`,
      method: "GET",
      queryParams: {
        ...(botId ? { bot_id: botId } : {}),
        ...(statusCode ? { status_code: statusCode } : {}),
      },
    });
  },

  getBot: async (botId) => {
    // Prefer v1 (includes recordings/media_shortcuts), fall back to v2.
    try {
      return await client.request({
        path: `/api/v1/bot/${botId}/`,
        method: "GET",
      });
    } catch (e) {
      console.log(
        `[RECALL] v1 bot fetch failed for ${botId}, trying v2: ${e.message}`
      );
      return await client.request({
        path: `/api/v2/bots/${botId}/`,
        method: "GET",
      });
    }
  },
  
  getBotNotes: async (botId) => {
    // Try to get notes/summaries from Recall.ai Notepad API
    // This endpoint may vary - checking common patterns
    try {
      return await client.request({
        path: `/api/v2/bots/${botId}/notes/`,
        method: "GET",
      });
    } catch (err) {
      // If notes endpoint doesn't exist, try alternative endpoints
      try {
        return await client.request({
          path: `/api/v2/bots/${botId}/summary/`,
          method: "GET",
        });
      } catch (err2) {
        // Try meeting notes endpoint if bot has event_id
        try {
          return await client.request({
            path: `/api/v2/bots/${botId}/notepad/`,
            method: "GET",
          });
        } catch (err3) {
          throw new Error(`Notepad API not available: ${err.message}`);
        }
      }
    }
  },
  
  getCalendarEventNotes: async (eventId) => {
    // Try to get notes from calendar event
    try {
      return await client.request({
        path: `/api/v2/calendar-events/${eventId}/notes/`,
        method: "GET",
      });
    } catch (err) {
      try {
        return await client.request({
          path: `/api/v2/calendar-events/${eventId}/summary/`,
          method: "GET",
        });
      } catch (err2) {
        throw new Error(`Event notes API not available: ${err.message}`);
      }
    }
  },

  /**
   * Fetch transcript for a bot (fallback when streaming didn't deliver).
   * Recall.ai provides transcript via media_shortcuts on recordings array
   * or via a dedicated transcript endpoint.
   */
  getBotTranscript: async (botId) => {
    // Try v1 API first (more reliable for older bots)
    try {
      const bot = await client.request({
        path: `/api/v1/bot/${botId}/`,
        method: "GET",
      });
      
      
      // Check for transcript in various locations
      // v1 API may have transcript directly or via URL
      if (bot.transcript) {
        console.log(`[RECALL] Found transcript directly on bot ${botId}`);
        return bot.transcript;
      }
      
      // Check for transcript URL - it's inside recordings[0].media_shortcuts.transcript.data.download_url
      let transcriptUrl = bot.transcript_url || 
                           bot.media_shortcuts?.transcript?.data?.download_url ||
                           bot.outputs?.transcript?.download_url;
      
      // Most common location: inside recordings array
      if (!transcriptUrl && bot.recordings && bot.recordings.length > 0) {
        for (const recording of bot.recordings) {
          transcriptUrl = recording.media_shortcuts?.transcript?.data?.download_url;
          if (transcriptUrl) {
            console.log(`[RECALL] Found transcript URL in recording for ${botId}`);
            break;
          }
        }
      }
      
      if (transcriptUrl) {
        console.log(`[RECALL] Downloading transcript for ${botId} from: ${transcriptUrl.substring(0, 100)}...`);
        const transcriptResponse = await fetch(transcriptUrl);
        if (transcriptResponse.ok) {
          const contentType = transcriptResponse.headers.get('content-type');
          const text = await transcriptResponse.text();
          console.log(`[RECALL] Downloaded transcript for ${botId}, length: ${text.length}, contentType: ${contentType}`);
          
          // Try to parse as JSON regardless of content type
          // The transcript is often JSON even when served with different content types
          try {
            const data = JSON.parse(text);
            console.log(`[RECALL] Parsed transcript JSON for ${botId}, type: ${Array.isArray(data) ? 'array' : typeof data}`);
            return data;
          } catch (e) {
            // If it's not valid JSON, return as plain text
            console.log(`[RECALL] Transcript for ${botId} is plain text, not JSON`);
            return { text, format: 'plain' };
          }
        } else {
          console.log(`[RECALL] Failed to download transcript for ${botId}: ${transcriptResponse.status}`);
        }
      }
      
      // Check for recording with transcript
      if (bot.recording?.transcript) {
        return bot.recording.transcript;
      }
      
      // Check outputs for transcript data
      if (bot.outputs?.transcript) {
        return bot.outputs.transcript;
      }
      
      console.log(`[RECALL] No transcript found in bot ${botId} details`);
      return null;
    } catch (e) {
      console.log(`[RECALL] v1 API failed for ${botId}: ${e.message}, trying v2...`);
    }
    
    // Fall back to v2 API
    try {
      const transcript = await client.request({
        path: `/api/v2/bots/${botId}/transcript/`,
        method: "GET",
      });
      if (transcript) return transcript;
    } catch (e) {
      console.log(`[RECALL] v2 transcript endpoint not available for ${botId}`);
    }
    
    // Try v2 bot details
    try {
      const bot = await client.request({
        path: `/api/v2/bots/${botId}/`,
        method: "GET",
      });
      
      // Check recordings array for transcript URL
      let transcriptUrl = bot.media_shortcuts?.transcript?.data?.download_url;
      if (!transcriptUrl && bot.recordings && bot.recordings.length > 0) {
        for (const recording of bot.recordings) {
          transcriptUrl = recording.media_shortcuts?.transcript?.data?.download_url;
          if (transcriptUrl) break;
        }
      }
      
      if (transcriptUrl) {
        const transcriptResponse = await fetch(transcriptUrl);
        if (transcriptResponse.ok) {
          return await transcriptResponse.json();
        }
      }
      
      return null;
    } catch (e) {
      console.log(`[RECALL] Could not get transcript for ${botId}: ${e.message}`);
      return null;
    }
  },

  /**
   * Fetch recording info for a bot.
   */
  getBotRecording: async (botId) => {
    return await client.request({
      path: `/api/v2/bots/${botId}/recording/`,
      method: "GET",
    });
  },

  /**
   * Extract downloadable recording URLs (video/audio) from a bot payload.
   * Handles v1/v2 structures and media_shortcuts.
   */
  getRecordingUrlsFromBot: (bot = {}) => {
    return extractRecordingUrls(bot);
  },

  /**
   * Convenience: fetch bot and return extracted recording URLs.
   */
  getBotRecordingUrls: async (botId) => {
    const bot = await recallService.getBot(botId);
    return {
      bot,
      ...extractRecordingUrls(bot),
    };
  },

  /**
   * List all bots (with pagination support)
   */
  listBots: async ({ status, limit = 100 } = {}) => {
    let bots = [];
    const params = {};
    if (status) params.status = status;
    if (limit) params.limit = limit;
    
    let pageUrl = client.buildUrl("/api/v1/bot/", params);
    
    while (true) {
      let { results, next } = await client.request({
        url: pageUrl,
        method: "GET",
      });
      bots = bots.concat(results || []);
      if (!next || bots.length >= limit) {
        break;
      }
      if (next.indexOf("https:") === -1 && pageUrl.indexOf("https:") !== -1) {
        next = next.replace("http:", "https:");
      }
      pageUrl = next;
    }
    return bots.slice(0, limit);
  },
};

export default recallService;

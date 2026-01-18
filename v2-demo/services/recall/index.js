import { getClient } from "./api-client.js";

let client = null;
export default {
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
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/recall/index.js:62',message:'Recall API addBotToCalendarEvent called',data:{calendarEventId:id,deduplicationKey,hasBotConfig:!!botConfig,hasJoinAt:!!botConfig?.join_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    
    const result = await client.request({
      path: `/api/v2/calendar-events/${id}/bot/`,
      method: "POST",
      data: {
        deduplication_key: deduplicationKey,
        bot_config: botConfig,
      },
    });
    
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/recall/index.js:71',message:'Recall API addBotToCalendarEvent response',data:{calendarEventId:id,hasResult:!!result,resultBots:result?.bots?.length||0,botIds:result?.bots?.map(b=>b.id)||[],resultKeys:Object.keys(result||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    
    return result;
  },
  removeBotFromCalendarEvent: async ({ id }) => {
    return await client.request({
      path: `/api/v2/calendar-events/${id}/bot/`,
      method: "DELETE",
    });
  },
  
  // Bot and Notepad API methods
  getBot: async (botId) => {
    return await client.request({
      path: `/api/v2/bots/${botId}/`,
      method: "GET",
    });
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

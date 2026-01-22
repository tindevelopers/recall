/**
 * Microsoft Graph Service for Teams Recordings and Transcripts
 * 
 * Provides high-level methods to fetch Teams meeting transcripts and recordings
 */

import MicrosoftGraphApi from "./api-client.js";
import db from "../../db.js";
import { refreshMicrosoftOutlookToken } from "../../logic/oauth.js";

/**
 * Get Microsoft Graph API client for a calendar
 * @param {Object} calendar - Calendar model instance with OAuth tokens
 * @returns {MicrosoftGraphApi|null} API client or null if tokens unavailable
 */
function getGraphClient(calendar) {
  // Get OAuth tokens from calendar's recallData
  // Tokens are typically stored in recallData or a separate tokens table
  // Note: Recall.ai stores tokens, but we may need to get them from Microsoft directly
  // For now, we'll try to get them from Recall's stored data or refresh them
  
  // Check if tokens are stored in recallData (they might be stored by Recall.ai)
  const tokens = calendar.recallData?.tokens || calendar.recallData?.oauth_tokens;
  
  // If no access token, we'll need to refresh using the refresh token stored in Recall
  // Recall.ai stores oauth_refresh_token when creating/updating calendars
  const refreshToken = calendar.recallData?.oauth_refresh_token || tokens?.refresh_token;
  
  if (!refreshToken) {
    console.log(`[MS Graph] No refresh token found for calendar ${calendar.id}`);
    return null;
  }

  // Token refresh callback
  const tokenRefreshCallback = async (refreshToken) => {
    try {
      console.log(`[MS Graph] Refreshing access token for calendar ${calendar.id}`);
      const newTokens = await refreshMicrosoftOutlookToken(refreshToken);
      
      // Update calendar's recallData with new tokens (optional - tokens may be managed by Recall.ai)
      // For now, we'll just use the new access token for this request
      
      return newTokens;
    } catch (error) {
      console.error(`[MS Graph] Token refresh failed:`, error);
      return null;
    }
  };

  // If we have an access token, use it; otherwise, we'll refresh on first request
  const accessToken = tokens?.access_token || null;

  return new MicrosoftGraphApi({
    accessToken, // May be null, will trigger refresh on first request
    refreshToken,
    tokenRefreshCallback,
  });
}

/**
 * Extract Teams meeting ID from calendar event
 * Teams meetings have joinWebUrl that can be used to identify them
 * @param {Object} calendarEvent - CalendarEvent model instance
 * @returns {Object|null} { userId, meetingId } or null if not a Teams meeting
 */
function extractTeamsMeetingInfo(calendarEvent) {
  const meetingUrl = calendarEvent.meetingUrl;
  if (!meetingUrl || typeof meetingUrl !== "string") {
    return null;
  }

  // Check if it's a Teams meeting URL
  if (!meetingUrl.includes("teams.microsoft.com")) {
    return null;
  }

  // Try to get onlineMeeting ID from calendar event data
  // Microsoft Graph stores onlineMeeting info in calendar events
  const onlineMeetingId = calendarEvent.recallData?.raw?.onlineMeeting?.id ||
                          calendarEvent.recallData?.onlineMeeting?.id;
  
  // Extract meeting ID from Teams URL as fallback
  // Format: https://teams.microsoft.com/l/meetup-join/...
  // Or: https://teams.microsoft.com/l/meeting/...
  const meetupMatch = meetingUrl.match(/\/meetup-join\/([^\/\?]+)/);
  const meetingMatch = meetingUrl.match(/\/meeting\/([^\/\?]+)/);
  
  const meetingIdFromUrl = meetupMatch?.[1] || meetingMatch?.[1];
  const meetingId = onlineMeetingId || meetingIdFromUrl;
  
  if (!meetingId) {
    console.log(`[MS Graph] Could not extract meeting ID from Teams URL: ${meetingUrl}`);
    return null;
  }

  // Get organizer/user ID from calendar
  // For Microsoft Outlook calendars, the organizer email is in recallData
  const organizerEmail = calendarEvent.recallData?.raw?.organizer?.emailAddress?.address ||
                         calendarEvent.recallData?.organizer?.email ||
                         calendarEvent.Calendar?.email;

  if (!organizerEmail) {
    console.log(`[MS Graph] Could not find organizer email for calendar event ${calendarEvent.id}`);
    return null;
  }

  // For Graph API, we typically use the organizer's user ID (email or object ID)
  // Note: We may need to look up the user's object ID, but email often works
  // Some endpoints accept email, others require object ID
  return {
    userId: organizerEmail, // Graph API accepts email as userId in many cases
    meetingId: meetingId,
    joinWebUrl: meetingUrl,
    onlineMeetingId: onlineMeetingId, // Prefer this if available
  };
}

/**
 * Fetch transcript for a Teams meeting
 * @param {Object} calendarEvent - CalendarEvent model instance
 * @returns {Promise<Object|null>} Transcript data or null
 */
export async function fetchTeamsTranscript(calendarEvent) {
  try {
    const calendar = calendarEvent.Calendar || await calendarEvent.getCalendar();
    if (!calendar || calendar.platform !== "microsoft_outlook") {
      return null;
    }

    const meetingInfo = extractTeamsMeetingInfo(calendarEvent);
    if (!meetingInfo) {
      return null;
    }

    const client = getGraphClient(calendar);
    if (!client) {
      console.log(`[MS Graph] Could not create API client for calendar ${calendar.id}`);
      return null;
    }

    // Refresh token if needed (if access token is missing)
    if (!client.accessToken && client.refreshToken && client.tokenRefreshCallback) {
      console.log(`[MS Graph] Access token missing, refreshing...`);
      const newTokens = await client.tokenRefreshCallback(client.refreshToken);
      if (newTokens?.access_token) {
        client.accessToken = newTokens.access_token;
      } else {
        console.error(`[MS Graph] Failed to refresh access token`);
        return null;
      }
    }

    // List available transcripts for the meeting
    // Note: userId might need to be the organizer's object ID, but email often works
    const transcriptsResponse = await client.listMeetingTranscripts(
      meetingInfo.userId,
      meetingInfo.meetingId
    );

    const transcripts = transcriptsResponse?.value || transcriptsResponse || [];
    if (transcripts.length === 0) {
      console.log(`[MS Graph] No transcripts found for meeting ${meetingInfo.meetingId}`);
      return null;
    }

    // Get the first available transcript (usually there's one per meeting)
    const transcript = transcripts[0];
    const transcriptId = transcript.id || transcript.transcriptId;

    if (!transcriptId) {
      console.log(`[MS Graph] Transcript found but no ID: ${JSON.stringify(transcript)}`);
      return null;
    }

    // Download transcript content
    const transcriptContent = await client.getTranscriptContent(
      meetingInfo.userId,
      meetingInfo.meetingId,
      transcriptId
    );

    if (!transcriptContent) {
      return null;
    }

    return {
      transcriptId,
      content: transcriptContent,
      format: "vtt",
      metadata: transcript,
      meetingId: meetingInfo.meetingId,
      userId: meetingInfo.userId,
    };
  } catch (error) {
    console.error(`[MS Graph] Error fetching Teams transcript:`, error);
    console.error(`[MS Graph] Error details:`, {
      message: error.message,
      status: error.status,
      body: error.body,
    });
    return null;
  }
}

/**
 * Check if a calendar event is a Teams meeting with recording available
 * @param {Object} calendarEvent - CalendarEvent model instance
 * @returns {Promise<boolean>} True if Teams meeting with recording
 */
export async function hasTeamsRecording(calendarEvent) {
  try {
    const calendar = calendarEvent.Calendar || await calendarEvent.getCalendar();
    if (!calendar || calendar.platform !== "microsoft_outlook") {
      return false;
    }

    const meetingInfo = extractTeamsMeetingInfo(calendarEvent);
    if (!meetingInfo) {
      return false;
    }

    const client = getGraphClient(calendar);
    if (!client) {
      return false;
    }

    // Check if meeting has recordings
    const recordings = await client.getMeetingRecordings(
      meetingInfo.userId,
      meetingInfo.meetingId
    );

    return !!recordings;
  } catch (error) {
    console.error(`[MS Graph] Error checking Teams recording:`, error);
    return false;
  }
}

/**
 * Parse VTT transcript content into structured format
 * @param {string} vttContent - WebVTT formatted transcript
 * @returns {Array} Array of transcript chunks with speaker, text, timestamps
 */
export function parseVTTTranscript(vttContent) {
  const chunks = [];
  const lines = vttContent.split("\n");
  
  let currentChunk = null;
  let sequence = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines and WEBVTT header
    if (!line || line === "WEBVTT" || line.startsWith("NOTE")) {
      continue;
    }

    // Timestamp line (e.g., "00:00:10.500 --> 00:00:15.200")
    const timestampMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
    if (timestampMatch) {
      const startTimeMs = parseFloat(timestampMatch[1]) * 3600000 +
                          parseFloat(timestampMatch[2]) * 60000 +
                          parseFloat(timestampMatch[3]) * 1000 +
                          parseFloat(timestampMatch[4]);
      const endTimeMs = parseFloat(timestampMatch[5]) * 3600000 +
                       parseFloat(timestampMatch[6]) * 60000 +
                       parseFloat(timestampMatch[7]) * 1000 +
                       parseFloat(timestampMatch[8]);
      
      currentChunk = {
        sequence: sequence++,
        startTimeMs,
        endTimeMs,
        speaker: null,
        text: "",
      };
      continue;
    }

    // Speaker identification (e.g., "<v Speaker Name>")
    const speakerMatch = line.match(/<v\s+([^>]+)>/);
    if (speakerMatch && currentChunk) {
      currentChunk.speaker = speakerMatch[1].trim();
      continue;
    }

    // Text content
    if (currentChunk && line && !line.startsWith("<")) {
      // Remove any remaining VTT tags
      const cleanText = line.replace(/<[^>]+>/g, "").trim();
      if (cleanText) {
        currentChunk.text += (currentChunk.text ? " " : "") + cleanText;
      }
    }

    // If we hit a blank line after a chunk, save it
    if (!line && currentChunk && currentChunk.text) {
      chunks.push(currentChunk);
      currentChunk = null;
    }
  }

  // Don't forget the last chunk
  if (currentChunk && currentChunk.text) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export default {
  fetchTeamsTranscript,
  hasTeamsRecording,
  parseVTTTranscript,
  extractTeamsMeetingInfo,
};


/**
 * Microsoft Graph API Client for Teams Recordings and Transcripts
 * 
 * Handles authentication and API requests to Microsoft Graph for:
 * - Online meeting transcripts
 * - Online meeting recordings
 * - Meeting metadata
 */

class MicrosoftGraphApi {
  constructor({ accessToken, refreshToken, tokenRefreshCallback }) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenRefreshCallback = tokenRefreshCallback;
    this.baseUrl = "https://graph.microsoft.com/v1.0";
  }

  async request({ path, method = "GET", headers = {}, body }) {
    const url = `${this.baseUrl}${path}`;
    
    try {
      const parsedUrl = new URL(url);
      console.log(`[MS Graph] Making ${method} request to ${parsedUrl.pathname}`);
    } catch {
      console.log(`[MS Graph] Making ${method} request to ${path}`);
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    // Handle token refresh on 401 or if access token is missing
    if ((response.status === 401 || !this.accessToken) && this.refreshToken && this.tokenRefreshCallback) {
      console.log(`[MS Graph] Token expired or missing, attempting refresh...`);
      const newTokens = await this.tokenRefreshCallback(this.refreshToken);
      if (newTokens?.access_token) {
        this.accessToken = newTokens.access_token;
        // Update refresh token if provided
        if (newTokens.refresh_token) {
          this.refreshToken = newTokens.refresh_token;
        }
        // Retry the request with new token
        return this.request({ path, method, headers, body });
      } else {
        throw new Error("Failed to refresh access token");
      }
    }

    if (response.status > 299) {
      const errorBody = await response.text();
      const err = new Error(
        `Microsoft Graph API ${method} ${path} failed with status ${response.status}: ${errorBody}`
      );
      err.status = response.status;
      err.body = errorBody;
      throw err;
    }

    // Handle empty responses
    if (response.status === 204 || !response.body) {
      return null;
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return await response.json();
    } else {
      // For binary content (like transcript .vtt files), return as text/blob
      return await response.text();
    }
  }

  /**
   * List transcripts for a specific online meeting
   * @param {string} userId - User ID (organizer or participant)
   * @param {string} meetingId - Online meeting ID
   * @returns {Promise<Array>} Array of transcript objects
   */
  async listMeetingTranscripts(userId, meetingId) {
    return await this.request({
      path: `/users/${userId}/onlineMeetings/${meetingId}/transcripts`,
      method: "GET",
    });
  }

  /**
   * Get a specific transcript's metadata
   * @param {string} userId - User ID
   * @param {string} meetingId - Online meeting ID
   * @param {string} transcriptId - Transcript ID
   * @returns {Promise<Object>} Transcript metadata
   */
  async getTranscriptMetadata(userId, meetingId, transcriptId) {
    return await this.request({
      path: `/users/${userId}/onlineMeetings/${meetingId}/transcripts/${transcriptId}`,
      method: "GET",
    });
  }

  /**
   * Download transcript content (.vtt format)
   * @param {string} userId - User ID
   * @param {string} meetingId - Online meeting ID
   * @param {string} transcriptId - Transcript ID
   * @returns {Promise<string>} Transcript content as VTT text
   */
  async getTranscriptContent(userId, meetingId, transcriptId) {
    return await this.request({
      path: `/users/${userId}/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`,
      method: "GET",
      headers: {
        "Accept": "text/vtt, application/vtt, */*",
      },
    });
  }

  /**
   * Get online meeting details
   * @param {string} userId - User ID (organizer)
   * @param {string} meetingId - Online meeting ID
   * @returns {Promise<Object>} Meeting details
   */
  async getOnlineMeeting(userId, meetingId) {
    return await this.request({
      path: `/users/${userId}/onlineMeetings/${meetingId}`,
      method: "GET",
    });
  }

  /**
   * Find online meeting by join URL or meeting ID
   * Note: This may require searching calendar events or using different endpoints
   * @param {string} joinWebUrl - Teams meeting join URL
   * @returns {Promise<Object|null>} Meeting details or null
   */
  async findMeetingByJoinUrl(joinWebUrl) {
    // Extract meeting ID from Teams URL if possible
    // Teams URLs format: https://teams.microsoft.com/l/meetup-join/...
    const match = joinWebUrl.match(/\/meetup-join\/([^\/]+)/);
    if (!match) {
      console.log(`[MS Graph] Could not extract meeting ID from URL: ${joinWebUrl}`);
      return null;
    }

    // Note: Finding meetings by URL may require different approach
    // For now, we'll need the userId and meetingId from calendar events
    return null;
  }

  /**
   * List recordings for a meeting
   * Recordings are typically stored in OneDrive/SharePoint, not directly via this API
   * But we can check the meeting's recordingInfo property
   * @param {string} userId - User ID
   * @param {string} meetingId - Online meeting ID
   * @returns {Promise<Object>} Recording information
   */
  async getMeetingRecordings(userId, meetingId) {
    const meeting = await this.getOnlineMeeting(userId, meetingId);
    return meeting?.recordingInfo || null;
  }
}

export default MicrosoftGraphApi;


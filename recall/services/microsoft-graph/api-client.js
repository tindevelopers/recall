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
   * Tries /me/ endpoint first (delegated permissions), then /users/{userId}/
   * @param {string} userId - User ID (organizer or participant)
   * @param {string} meetingId - Online meeting ID
   * @returns {Promise<Array>} Array of transcript objects
   */
  async listMeetingTranscripts(userId, meetingId) {
    // Try /me/ endpoint first (works with delegated permissions)
    const endpoints = [
      `/me/onlineMeetings/${meetingId}/transcripts`,
      `/users/${userId}/onlineMeetings/${meetingId}/transcripts`,
    ];
    
    for (const path of endpoints) {
      try {
        const response = await this.request({
          path,
          method: "GET",
        });
        return response;
      } catch (error) {
        // If 403 or 400, try next endpoint
        if (error.status === 403 || error.status === 400) {
          console.log(`[MS Graph] Endpoint ${path.split('/transcripts')[0]} failed, trying next...`);
          continue;
        }
        throw error;
      }
    }
    
    // If all endpoints fail, throw the last error
    throw new Error(`Could not access transcripts for meeting ${meetingId}`);
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
   * Find online meeting by join URL
   * Uses the $filter query parameter to search by joinWebUrl
   * @param {string} userId - User ID (organizer)
   * @param {string} joinWebUrl - Teams meeting join URL
   * @returns {Promise<Object|null>} Meeting details or null
   */
  async findMeetingByJoinUrl(userId, joinWebUrl) {
    try {
      // Try using /me/onlineMeetings first (works with delegated permissions)
      // Then fall back to /users/{userId}/onlineMeetings
      const endpoints = [
        `/me/onlineMeetings?$filter=JoinWebUrl eq '${joinWebUrl}'`,
        `/users/${userId}/onlineMeetings?$filter=JoinWebUrl eq '${joinWebUrl}'`,
      ];
      
      for (const path of endpoints) {
        try {
          const response = await this.request({
            path,
            method: "GET",
          });
          
          const meetings = response?.value || [];
          if (meetings.length > 0) {
            console.log(`[MS Graph] Found meeting by joinWebUrl: ${meetings[0].id}`);
            return meetings[0];
          }
        } catch (endpointError) {
          // If 403, the token doesn't have OnlineMeetings.Read permission
          if (endpointError.status === 403) {
            console.log(`[MS Graph] Permission denied for ${path.split('?')[0]} - OnlineMeetings.Read permission may be required`);
            continue;
          }
          throw endpointError;
        }
      }
      
      console.log(`[MS Graph] No meeting found with joinWebUrl (user may need to re-authorize with OnlineMeetings.Read permission)`);
      return null;
    } catch (error) {
      console.error(`[MS Graph] Error finding meeting by joinWebUrl:`, error.message);
      return null;
    }
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


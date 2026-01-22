/**
 * Utility helpers to normalize meeting URLs and extract IDs/platforms so we can
 * store them persistently instead of re-parsing in the UI.
 */

/**
 * Normalize a meeting URL or object into a string.
 * Supports Recall payload formats where meeting_url can be an object.
 */
export function normalizeMeetingUrl(rawUrl) {
  if (!rawUrl) return null;
  if (typeof rawUrl === "string") return rawUrl;
  if (typeof rawUrl === "object") {
    if (rawUrl.url) return rawUrl.url;
    if (rawUrl.href) return rawUrl.href;
    if (rawUrl.link) return rawUrl.link;
    if (rawUrl.thread_id) return rawUrl.thread_id; // Teams thread id
  }
  return null;
}

/**
 * Detect conferencing platform from URL/identifier.
 */
export function extractMeetingPlatform(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes("teams.microsoft.com") || lower.includes("19:meeting_"))
    return "teams";
  if (lower.includes("zoom.us")) return "zoom";
  if (lower.includes("webex.com")) return "webex";
  if (lower.includes("meet.google.com")) return "google_meet";
  return null;
}

/**
 * Extract meeting ID for a given platform from a URL string.
 */
export function extractMeetingId(url, platform) {
  if (!url) return null;
  const decoded = decodeURIComponent(url);

  if (platform === "teams") {
    // Prefer thread id: 19:meeting_xxx@thread.v2
    const threadMatch = decoded.match(/19:meeting_[^@/]+@thread\.v2/i);
    if (threadMatch) return threadMatch[0];

    // /meet/<id>
    const pathMatch = decoded.match(/\/meet\/([A-Za-z0-9]+)/i);
    if (pathMatch) return pathMatch[1];
  }

  if (platform === "zoom") {
    const zoomMatch = decoded.match(/\/j\/(\d+)/);
    if (zoomMatch) return zoomMatch[1];
  }

  if (platform === "webex") {
    const webexMatch = decoded.match(/\/(\d{9,})/);
    if (webexMatch) return webexMatch[1];
  }

  if (platform === "google_meet") {
    const meetMatch = decoded.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    if (meetMatch) return meetMatch[1];
  }

  return null;
}

/**
 * Format meeting ID for display (spacing/grouping where applicable).
 */
export function formatDisplayId(meetingId, platform) {
  if (!meetingId) return null;
  if (platform === "teams" || platform === "zoom" || platform === "webex") {
    // group digits in 3s for readability
    return meetingId.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
  }
  return meetingId;
}

/**
 * Extract full metadata bundle from raw artifact/calendar data.
 */
export function extractMeetingMetadata({ meetingUrl, calendarMeetingUrl }) {
  const normalizedUrl =
    normalizeMeetingUrl(meetingUrl) || normalizeMeetingUrl(calendarMeetingUrl);

  const platform = extractMeetingPlatform(normalizedUrl);
  const meetingId = extractMeetingId(normalizedUrl, platform);

  return {
    meetingPlatform: platform || null,
    meetingId: meetingId || null,
    displayMeetingId: formatDisplayId(meetingId, platform),
    meetingUrl: normalizedUrl || null,
  };
}


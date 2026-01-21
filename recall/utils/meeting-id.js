/**
 * Generate a readable meeting identifier
 * Format: MTG-YYYYMMDD-HHH (Meeting-YYYYMMDD-3 random hex chars)
 * Example: MTG-20260119-A3F
 */
export function generateReadableMeetingId(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;
  
  // Generate 3 random hex characters
  const randomHex = Math.floor(Math.random() * 4096).toString(16).toUpperCase().padStart(3, '0');
  
  return `MTG-${dateStr}-${randomHex}`;
}

/**
 * Extract date from a readable meeting ID
 * Returns null if format is invalid
 */
export function extractDateFromMeetingId(meetingId) {
  const match = meetingId.match(/^MTG-(\d{8})-/);
  if (!match) return null;
  
  const dateStr = match[1];
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-indexed
  const day = parseInt(dateStr.substring(6, 8));
  
  return new Date(year, month, day);
}

/**
 * Generate a unique readable meeting ID with retry logic
 * @param {Date} date - The date to base the ID on
 * @param {Function} checkUnique - Async function that checks if an ID is unique: (id) => Promise<boolean>
 * @param {string} fallbackId - Optional fallback ID to use if all retries fail (e.g., UUID prefix)
 * @returns {Promise<string>} A unique readable meeting ID
 */
export async function generateUniqueReadableMeetingId(date = new Date(), checkUnique, fallbackId = null) {
  const MAX_RETRIES = 20;
  let retries = 0;
  let readableId = null;
  let isUnique = false;

  while (!isUnique && retries < MAX_RETRIES) {
    readableId = generateReadableMeetingId(date);
    try {
      isUnique = await checkUnique(readableId);
      if (!isUnique) {
        retries++;
      }
    } catch (err) {
      // If check fails, assume it's not unique and retry
      console.warn(`[MEETING-ID] Error checking uniqueness for ${readableId}:`, err.message);
      retries++;
      isUnique = false;
    }
  }

  // Fallback to using fallbackId or a UUID-based ID if unable to generate unique readable ID
  if (!isUnique) {
    if (fallbackId) {
      readableId = `MTG-UUID-${fallbackId.substring(0, 8).toUpperCase()}`;
      console.warn(`[MEETING-ID] Could not generate unique readableId after ${MAX_RETRIES} retries. Using fallback: ${readableId}`);
    } else {
      // Generate a timestamp-based fallback
      const timestamp = Date.now().toString(36).toUpperCase().slice(-6);
      readableId = `MTG-FALLBACK-${timestamp}`;
      console.warn(`[MEETING-ID] Could not generate unique readableId after ${MAX_RETRIES} retries. Using timestamp fallback: ${readableId}`);
    }
  }

  return readableId;
}


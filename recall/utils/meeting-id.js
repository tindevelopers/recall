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


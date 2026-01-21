import db from "../db.js";
import Recall from "../services/recall/index.js";

/**
 * Normalize a meeting URL for comparison.
 * Removes query parameters, fragments, and normalizes the URL.
 */
export function normalizeMeetingUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    const urlObj = new URL(url);
    // Remove query parameters and fragments
    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.toString().toLowerCase().trim();
  } catch {
    // If URL parsing fails, try basic normalization
    return url.toLowerCase().trim().split('?')[0].split('#')[0];
  }
}

/**
 * Extract company domain from email address.
 * Returns null if email is invalid or personal domain (gmail.com, outlook.com, etc.)
 */
export function extractCompanyDomain(email) {
  if (!email || typeof email !== 'string') return null;
  
  const personalDomains = [
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'aol.com',
    'protonmail.com',
    'proton.me',
  ];
  
  const domain = email.toLowerCase().split('@')[1];
  if (!domain) return null;
  
  // Don't treat personal domains as companies
  if (personalDomains.includes(domain)) return null;
  
  return domain;
}

/**
 * Check if another user from the same company already has a bot scheduled
 * for the same meeting URL.
 * 
 * @param {string} meetingUrl - The meeting URL to check
 * @param {string} currentUserId - The current user's ID
 * @param {string} currentUserEmail - The current user's email
 * @returns {Promise<{hasSharedBot: boolean, sharedEventId?: string, sharedBotId?: string}>}
 */
export async function checkForSharedBot(meetingUrl, currentUserId, currentUserEmail) {
  if (!meetingUrl) return { hasSharedBot: false };
  
  const normalizedUrl = normalizeMeetingUrl(meetingUrl);
  if (!normalizedUrl) return { hasSharedBot: false };
  
  const companyDomain = extractCompanyDomain(currentUserEmail);
  if (!companyDomain) {
    // Personal email - no sharing
    return { hasSharedBot: false };
  }
  
  // Find other users from the same company
  const companyUsers = await db.User.findAll({
    where: {
      email: {
        [db.Sequelize.Op.like]: `%@${companyDomain}`,
      },
      id: {
        [db.Sequelize.Op.ne]: currentUserId,
      },
    },
  });
  
  if (companyUsers.length === 0) {
    return { hasSharedBot: false };
  }
  
  const companyUserIds = companyUsers.map(u => u.id);
  
  // Find calendars for these users
  const companyCalendars = await db.Calendar.findAll({
    where: {
      userId: {
        [db.Sequelize.Op.in]: companyUserIds,
      },
    },
  });
  
  if (companyCalendars.length === 0) {
    return { hasSharedBot: false };
  }
  
  const companyCalendarIds = companyCalendars.map(c => c.id);
  
  // Find calendar events with the same meeting URL
  const sharedEvents = await db.CalendarEvent.findAll({
    where: {
      calendarId: {
        [db.Sequelize.Op.in]: companyCalendarIds,
      },
      startTime: {
        [db.Sequelize.Op.gte]: new Date(), // Only future events
      },
    },
    include: [
      {
        model: db.Calendar,
        include: [{ model: db.User }],
      },
    ],
  });
  
  // Check if any of these events have the same normalized meeting URL and have bots
  for (const event of sharedEvents) {
    const eventMeetingUrl = normalizeMeetingUrl(event.meetingUrl);
    if (eventMeetingUrl === normalizedUrl) {
      // Check if this event has bots scheduled
      const bots = event.bots || [];
      if (bots.length > 0) {
        // Found a shared bot!
        return {
          hasSharedBot: true,
          sharedEventId: event.recallId,
          sharedBotId: bots[0]?.id,
          sharedUserId: event.Calendar?.userId,
          sharedUserEmail: event.Calendar?.User?.email,
        };
      }
      
      // Also check Recall API directly
      try {
        const recallEvent = await Recall.getCalendarEvent(event.recallId);
        const recallBots = recallEvent?.bots || [];
        if (recallBots.length > 0) {
          return {
            hasSharedBot: true,
            sharedEventId: event.recallId,
            sharedBotId: recallBots[0]?.id,
            sharedUserId: event.Calendar?.userId,
            sharedUserEmail: event.Calendar?.User?.email,
          };
        }
      } catch (err) {
        // If we can't fetch from Recall API, continue checking other events
        console.log(`[SHARED-BOT] Could not fetch Recall event ${event.recallId}: ${err.message}`);
      }
    }
  }
  
  return { hasSharedBot: false };
}

/**
 * Get a shared deduplication key for bot scheduling based on meeting URL and company.
 * This allows multiple users from the same company to share a bot for the same meeting.
 */
export function getSharedDeduplicationKey(meetingUrl, userEmail) {
  const normalizedUrl = normalizeMeetingUrl(meetingUrl);
  const companyDomain = extractCompanyDomain(userEmail);
  
  if (!normalizedUrl || !companyDomain) {
    // Fall back to event-based deduplication
    return null;
  }
  
  // Create a shared key based on meeting URL + company domain
  // This ensures all users from the same company share the same bot for the same meeting
  return `shared-bot-${companyDomain}-${normalizedUrl.replace(/[^a-z0-9]/g, '-')}`;
}


import { generateNotice } from "./utils.js";
import {
  buildGoogleCalendarOAuthUrl,
  buildMicrosoftOutlookOAuthUrl,
} from "../logic/oauth.js";
import { buildNotionOAuthUrl } from "../logic/notion-oauth.js";
import Recall from "../services/recall/index.js";
import { getPageOrDatabase } from "../services/notion/api-client.js";
import db from "../db.js";

export default async (req, res) => {
  if (req.authenticated) {
    const allCalendars = await req.authentication.user.getCalendars();
    
    // Filter out disconnected calendars - they shouldn't be displayed
    const calendars = allCalendars.filter((calendar) => {
      const status = calendar.status || calendar.recallData?.status;
      return status !== "disconnected" && status !== null && status !== undefined;
    });
    
    // Pick the most recently updated calendar per platform (we only support one connection
    // per platform per user; reconnect should update the existing record instead of creating a new one).
    // Only include connected calendars for OAuth URL building
    const calendarIdByPlatform = new Map();
    // Ensure deterministic ordering even if the association doesn't sort
    const calendarsSorted = [...calendars].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    for (const calendar of calendarsSorted) {
      const status = calendar.status || calendar.recallData?.status;
      // Only include connected calendars for reconnection URLs
      if (!calendarIdByPlatform.has(calendar.platform) && status === "connected") {
        calendarIdByPlatform.set(calendar.platform, calendar.id);
      }
    }
    
    // Refresh calendar data from Recall to get latest status
    // This ensures "connecting" becomes "connected" after Recall finishes
    // Also refresh calendars that don't have a status set yet
    // Check for disconnected calendars and notify user
    let hasDisconnectedCalendar = false;
    let disconnectedCalendarEmails = [];
    
    for (const calendar of calendars) {
      const currentStatus = calendar.status || calendar.recallData?.status;
      if (currentStatus === "connecting" || !currentStatus) {
        try {
          const recallCalendar = await Recall.getCalendar(calendar.recallId);
          if (recallCalendar) {
            // Update recallData with latest from Recall API
            calendar.recallData = recallCalendar;
            await calendar.save();
          }
        } catch (err) {
          console.error(`Failed to refresh calendar ${calendar.id}:`, err.message);
        }
      }
      
      // Check if calendar is disconnected
      if (currentStatus === "disconnected") {
        hasDisconnectedCalendar = true;
        const email = calendar.email || calendar.recallData?.platform_email || "your calendar";
        const platform = calendar.platform === "google_calendar" ? "Google Calendar" : "Microsoft Outlook";
        disconnectedCalendarEmails.push(`${platform} (${email})`);
      }
    }
    
    // Show notification if there are disconnected calendars
    if (hasDisconnectedCalendar && !req.notice) {
      const message = disconnectedCalendarEmails.length === 1
        ? `Your ${disconnectedCalendarEmails[0]} connection has been disconnected. Please reconnect your calendar to continue receiving meeting recordings.`
        : `Your calendar connections (${disconnectedCalendarEmails.join(", ")}) have been disconnected. Please reconnect them to continue receiving meeting recordings.`;
      
      const notice = generateNotice("error", message);
      req.notice = notice;
      // Set cookie so notice persists across page loads
      res.cookie("notice", JSON.stringify(notice));
    }
    
    const notionIntegration = await req.authentication.user.getIntegrations({
      where: { provider: "notion" },
      limit: 1,
    });
    const notionTarget = await req.authentication.user.getPublishTargets({
      where: { type: "notion" },
      limit: 1,
    });
    
    // Fetch details about the current Notion target if one exists
    let notionTargetDetails = null;
    if (notionIntegration?.[0] && notionTarget?.[0]?.config?.destinationId) {
      try {
        notionTargetDetails = await getPageOrDatabase({
          accessToken: notionIntegration[0].accessToken,
          id: notionTarget[0].config.destinationId,
        });
      } catch (err) {
        console.error("Failed to fetch Notion target details:", err.message);
      }
    }
    
    // Fetch upcoming meetings (next 7 days)
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const calendarIds = calendars.map(c => c.id);
    
    let upcomingMeetings = [];
    if (calendarIds.length > 0) {
      try {
        const { Op } = await import("sequelize");
        upcomingMeetings = await db.CalendarEvent.findAll({
          where: {
            calendarId: { [Op.in]: calendarIds },
          },
          order: [["createdAt", "DESC"]],
          limit: 100,
        });
        
        // Filter to upcoming meetings (start_time > now) and sort by start time
        // Keep more than 5 so "scroll for more" has content
        upcomingMeetings = upcomingMeetings
          .filter(event => {
            const startTime = new Date(event.recallData?.start_time);
            return startTime > now && startTime < sevenDaysFromNow;
          })
          .sort((a, b) => {
            const aTime = new Date(a.recallData?.start_time);
            const bTime = new Date(b.recallData?.start_time);
            return aTime - bTime;
          })
          // Transform to plain objects with title extracted (virtual getters don't work in EJS)
          .map(event => {
            // Extract attendees from calendar event raw data
            const raw = event.recallData?.raw || {};
            const attendees = [];
            
            if (event.platform === "google_calendar") {
              const gcalAttendees = raw["attendees"] || [];
              for (const att of gcalAttendees) {
                attendees.push({
                  email: att.email,
                  name: att.displayName || att.email?.split('@')[0] || 'Unknown',
                  organizer: att.organizer || false,
                });
              }
              if (raw.organizer && !attendees.find(a => a.email === raw.organizer.email)) {
                attendees.push({
                  email: raw.organizer.email,
                  name: raw.organizer.displayName || raw.organizer.email?.split('@')[0] || 'Unknown',
                  organizer: true,
                });
              }
            } else if (event.platform === "microsoft_outlook") {
              const msAttendees = raw["attendees"] || [];
              for (const att of msAttendees) {
                attendees.push({
                  email: att.emailAddress?.address,
                  name: att.emailAddress?.name || att.emailAddress?.address?.split('@')[0] || 'Unknown',
                  organizer: false,
                });
              }
              if (raw.organizer?.emailAddress) {
                attendees.push({
                  email: raw.organizer.emailAddress.address,
                  name: raw.organizer.emailAddress.name || raw.organizer.emailAddress.address?.split('@')[0] || 'Unknown',
                  organizer: true,
                });
              }
            }
            
            return {
              id: event.id,
              title: event.title || 'Untitled Meeting',  // Use virtual getter here
              recallData: event.recallData,
              shouldRecordAutomatic: event.shouldRecordAutomatic,
              shouldRecordManual: event.shouldRecordManual,
              platform: event.platform,
              attendees: attendees.slice(0, 5),  // Limit to first 5 for display
            };
          });
        // #region agent log
        // Debug: Log first 3 upcoming meetings to verify title sources
        upcomingMeetings.slice(0, 3).forEach((event, idx) => {
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/root.js:upcomingMeetings',message:'Upcoming meeting title after transform',data:{idx,eventId:event.id,platform:event.platform,title:event.title},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
        });
        // #endregion
        // Pass all upcoming for scrollable list (view shows first 5 visible + scroll for more)
      } catch (err) {
        console.error("Failed to fetch upcoming meetings:", err.message);
      }
    }

    // Fetch last 5 past meetings (recorded/synced) for home
    let pastMeetings = [];
    try {
      const { Op } = await import("sequelize");
      const userId = req.authentication.user.id;
      let sharedArtifactIds = [];
      const user = await db.User.findByPk(userId);
      if (user?.email) {
        const shares = await db.MeetingShare.findAll({
          where: {
            status: "accepted",
            [Op.or]: [{ sharedWithUserId: userId }, { sharedWithEmail: user.email.toLowerCase() }],
          },
          attributes: ["meetingArtifactId"],
        });
        sharedArtifactIds = shares.map((s) => s.meetingArtifactId);
      }
      // Get all past meetings, ordered by most recent first
      let artifactResult = await db.MeetingArtifact.findAll({
        where: {
          [Op.or]: [
            { userId },
            { ownerUserId: userId },
            ...(sharedArtifactIds.length > 0 ? [{ id: { [Op.in]: sharedArtifactIds } }] : []),
          ],
        },
        include: [
          { model: db.CalendarEvent, required: false },
          { model: db.MeetingSummary, required: false },
        ],
        order: [["createdAt", "DESC"]],
        limit: 5,
      });
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/root.js:artifactQuery',message:'All artifacts for past meetings',data:{artifactCount:artifactResult.length,artifacts:artifactResult.slice(0,10).map(a=>({id:a.id,calendarEventId:a.calendarEventId,hasCalEvent:!!a.CalendarEvent,calEventTitle:a.CalendarEvent?.title,calEventRawSummary:a.CalendarEvent?.recallData?.raw?.summary,dataTitle:a.rawPayload?.data?.title,recallBotId:a.recallBotId,createdAt:a.createdAt}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H19'})}).catch(()=>{});
      // #endregion
      
      // Build a map of CalendarEvents by recallId for lookup
      const calendarEventIds = artifactResult
        .map(a => a.rawPayload?.data?.calendar_event_id)
        .filter(Boolean);
      const calendarEventsMap = new Map();
      if (calendarEventIds.length > 0) {
        const calEvents = await db.CalendarEvent.findAll({
          where: { recallId: { [Op.in]: calendarEventIds } }
        });
        for (const ce of calEvents) {
          calendarEventsMap.set(ce.recallId, ce);
        }
      }
      
      // Fetch bot data from Recall API to get proper titles (calendar_meetings data)
      const botDataMap = new Map();
      const botIds = artifactResult.map(a => a.recallBotId).filter(Boolean);
      if (botIds.length > 0) {
        const botPromises = botIds.map(async (botId) => {
          try {
            const botData = await Recall.getBot(botId);
            return { botId, data: botData };
          } catch (e) {
            return { botId, data: null };
          }
        });
        const botResults = await Promise.all(botPromises);
        for (const { botId, data } of botResults) {
          if (data) botDataMap.set(botId, data);
        }
        // #region agent log
        if (botResults.length > 0) {
          const sampleBot = botResults[0]?.data;
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/root.js:botDataStructure',message:'Sample bot data structure from Recall API',data:{botId:botResults[0]?.botId,topLevelKeys:sampleBot ? Object.keys(sampleBot) : [],hasCalMeetings:!!sampleBot?.calendar_meetings,hasMeetingMetadata:!!sampleBot?.meeting_metadata,hasParticipants:!!sampleBot?.participants,sampleCalMeetings:sampleBot?.calendar_meetings?.slice?.(0,1),sampleParticipants:sampleBot?.participants?.slice?.(0,2),meetingMetadata:sampleBot?.meeting_metadata},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H12'})}).catch(()=>{});
        }
        // #endregion
      }
      
      pastMeetings = artifactResult.map((artifact) => {
        // Try to get CalendarEvent from association first, then from rawPayload calendar_event_id
        let cal = artifact.CalendarEvent;
        if (!cal) {
          const recallEventId = artifact.rawPayload?.data?.calendar_event_id;
          if (recallEventId) {
            cal = calendarEventsMap.get(recallEventId);
          }
        }
        const summary = (artifact.MeetingSummaries && artifact.MeetingSummaries[0]) || artifact.MeetingSummary;
        const data = artifact.rawPayload?.data || {};
        const startTime =
          data.start_time || (cal && cal.recallData?.start_time) || artifact.createdAt;
        
        // Helper to check if title is generic
        const isGeneric = (t) => !t || ['Meeting', 'Untitled Meeting', 'Untitled', 'meeting'].includes(t);
        
        // FAST PATH: Use cached title and attendees from artifact if available
        // These fields are populated when artifact is created (new architecture)
        if (artifact.title && !isGeneric(artifact.title)) {
          const attendees = artifact.attendeesJson || [];
          // #region agent log
          fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/root.js:pastMeetings:fastPath',message:'Using cached title and attendees',data:{artifactId:artifact.id,cachedTitle:artifact.title,cachedAttendeesCount:attendees.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H20'})}).catch(()=>{});
          // #endregion
          return {
            id: artifact.id,
            title: artifact.title,
            startTime,
            durationSeconds: data.duration_seconds || artifact.recordingDuration || null,
            platform: cal?.platform || null,
            hasRecording: !!(data.video_url || data.recording_url || artifact.sourceRecordingUrl),
            attendees: attendees,
          };
        }
        
        // SLOW PATH: Extract title and attendees from various sources (for older artifacts)
        // Get fresh bot data from Recall API
        const freshBotData = artifact.recallBotId ? botDataMap.get(artifact.recallBotId) : null;
        
        // Pre-extract speakers from transcript (used as fallback for title and attendees)
        let transcriptSpeakers = [];
        if (Array.isArray(data.transcript) && data.transcript.length > 0) {
          const speakerSet = new Set();
          for (const segment of data.transcript) {
            const speaker = segment.participant?.name || segment.speaker;
            if (speaker && speaker !== 'Speaker' && speaker !== 'Unknown') {
              speakerSet.add(speaker);
            }
          }
          transcriptSpeakers = Array.from(speakerSet);
        }
        
        // Try sources in priority order:
        let title = null;
        
        // 1) Fresh bot data calendar_meetings (most reliable source - from Recall API)
        if (!title && freshBotData) {
          const freshCalMeetings = freshBotData.calendar_meetings;
          if (Array.isArray(freshCalMeetings) && freshCalMeetings.length > 0) {
            for (const cm of freshCalMeetings) {
              if (cm?.title && !isGeneric(cm.title)) {
                title = cm.title;
                break;
              }
            }
          }
        }
        
        // 2) Summary title (from AI summary)
        if (!title && summary?.title && !isGeneric(summary.title)) {
          title = summary.title;
        }
        
        // 3) Calendar event title (virtual getter)
        if (!title && cal?.title && !isGeneric(cal.title)) {
          title = cal.title;
        }
        
        // 4) Calendar event raw fields
        if (!title) {
          const calRaw = cal?.recallData?.raw?.summary || cal?.recallData?.raw?.subject;
          if (calRaw && !isGeneric(calRaw)) {
            title = calRaw;
          }
        }
        
        // 5) Bot calendar_meetings title (from cached artifact data)
        if (!title) {
          const botCalMeetings = data.bot_metadata?.calendar_meetings || data.calendar_meetings;
          if (Array.isArray(botCalMeetings) && botCalMeetings.length > 0) {
            for (const cm of botCalMeetings) {
              if (cm?.title && !isGeneric(cm.title)) {
                title = cm.title;
                break;
              }
            }
          }
        }
        
        // 6) Bot meeting_metadata title
        if (!title) {
          const botMetaTitle = data.bot_metadata?.meeting_metadata?.title;
          if (botMetaTitle && !isGeneric(botMetaTitle)) {
            title = botMetaTitle;
          }
        }
        
        // 7) Artifact rawPayload title fields
        if (!title) {
          const artifactTitle = data.meeting_title || data.event_title || 
            data.calendar_event?.title || data.calendar_event?.summary;
          if (artifactTitle && !isGeneric(artifactTitle)) {
            title = artifactTitle;
          }
        }
        
        // 8) Build from participants (from fresh bot data or cached data)
        if (!title || isGeneric(title)) {
          const participants = freshBotData?.participants || data.participants || [];
          if (Array.isArray(participants) && participants.length > 0) {
            const names = participants
              .slice(0, 2)
              .map(p => p.name || p.speaker || p.email?.split('@')[0])
              .filter(Boolean);
            if (names.length > 0) {
              title = `Meeting with ${names.join(' and ')}${participants.length > 2 ? ` +${participants.length - 2}` : ''}`;
            }
          }
        }
        
        // 9) Build from transcript speakers as fallback
        if ((!title || isGeneric(title)) && transcriptSpeakers.length > 0) {
          const names = transcriptSpeakers.slice(0, 2);
          title = `Meeting with ${names.join(' and ')}${transcriptSpeakers.length > 2 ? ` +${transcriptSpeakers.length - 2}` : ''}`;
        }
        
        // 10) Date-based fallback
        if (!title || isGeneric(title)) {
          const meetingDate = new Date(startTime);
          if (!isNaN(meetingDate.getTime())) {
            title = `Meeting on ${meetingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          } else {
            title = "Meeting";
          }
        }
        
        const platform = cal?.platform || null;
        
        // Extract attendees from fresh bot data or cached data
        let attendees = [];
        if (freshBotData?.calendar_meetings?.length > 0) {
          const cm = freshBotData.calendar_meetings[0];
          if (Array.isArray(cm?.attendees)) {
            attendees = cm.attendees.map(a => ({
              email: a.email,
              name: a.name || a.email?.split('@')[0],
              organizer: a.is_organizer || false,
            }));
          }
        }
        // Fallback to participants if no calendar_meetings attendees
        if (attendees.length === 0) {
          const participants = freshBotData?.participants || data.participants || [];
          if (Array.isArray(participants)) {
            attendees = participants.map(p => ({
              email: p.email,
              name: p.name || p.speaker || p.email?.split('@')[0],
              organizer: false,
            }));
          }
        }
        // Fallback to transcript speakers if still no attendees
        if (attendees.length === 0 && transcriptSpeakers.length > 0) {
          attendees = transcriptSpeakers.map(name => ({
            email: null,
            name: name,
            organizer: false,
          }));
        }
        
        // #region agent log
        fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/root.js:pastMeetings:slowPath',message:'Extracted title/attendees from sources',data:{artifactId:artifact.id,finalTitle:title,attendeesCount:attendees.length,attendeeNames:attendees.slice(0,3).map(a=>a.name),hasOrganizer:attendees.some(a=>a.organizer)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H17'})}).catch(()=>{});
        // #endregion
        return {
          id: artifact.id,
          title: title,
          startTime,
          durationSeconds: data.duration_seconds || artifact.recordingDuration || null,
          platform,
          hasRecording: !!(data.video_url || data.recording_url || artifact.sourceRecordingUrl),
          attendees: attendees,
        };
      });
    } catch (err) {
      console.error("Failed to fetch past meetings:", err.message);
    }

    return res.render("index.ejs", {
      notice: req.notice,
      user: req.authentication.user,
      calendars,
      upcomingMeetings,
      pastMeetings,
      notion: {
        integration: notionIntegration?.[0] || null,
        target: notionTarget?.[0] || null,
        targetDetails: notionTargetDetails,
      },
      connectUrls: {
        googleCalendar: buildGoogleCalendarOAuthUrl({
          userId: req.authentication.user.id,
          calendarId: calendarIdByPlatform.get("google_calendar") || undefined,
        }),
        microsoftOutlook: buildMicrosoftOutlookOAuthUrl({
          userId: req.authentication.user.id,
          calendarId: calendarIdByPlatform.get("microsoft_outlook") || undefined,
        }),
        notion: buildNotionOAuthUrl({ userId: req.authentication.user.id }),
      },
    });
  } else {
    res.cookie(
      "notice",
      JSON.stringify(
        generateNotice("error", "You must be signed in to proceed.")
      )
    );
    return res.redirect("/sign-in");
  }
};

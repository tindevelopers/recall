import dotenv from "dotenv";
import db from "./db.js";
import Recall from "./services/recall/index.js";

dotenv.config();

/**
 * Diagnostic script to check V2 bot scheduling status
 * Verifies:
 * - Database connection
 * - Calendar configuration
 * - Recent calendar events
 * - Bot scheduling status
 * - Webhook endpoint configuration
 */

async function checkV2BotScheduling() {
  console.log('🔍 Checking V2 Bot Scheduling Status\n');
  console.log(`API Host: ${process.env.RECALL_API_HOST || 'Not set'}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'PostgreSQL (configured)' : '❌ NOT SET (DATABASE_URL required)'}`);
  console.log(`Public URL: ${process.env.PUBLIC_URL || 'Not set'}`);
  console.log('');
  
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL is required. PostgreSQL database must be configured.');
    console.log('   Set DATABASE_URL environment variable to your PostgreSQL connection string.\n');
    process.exit(1);
  }
  
  try {
    // 1. Check database connection
    console.log('📊 Step 1: Checking database connection...');
    try {
      await db.sequelize.authenticate();
      console.log('   ✅ Database connection successful\n');
    } catch (err) {
      console.log(`   ❌ Database connection failed: ${err.message}\n`);
      return;
    }
    
    // 2. Check calendar configuration
    console.log('📅 Step 2: Checking calendar configuration...');
    let calendars = [];
    try {
      // Try to query with specific attributes to avoid missing column errors
      calendars = await db.Calendar.findAll({
        attributes: [
          'id',
          'platform',
          'recallId',
          'recallData',
          'autoRecordExternalEvents',
          'autoRecordOnlyConfirmedEvents',
          'enableTranscription',
          'transcriptionMode',
          'updatedAt',
        ],
        order: [['updatedAt', 'DESC']],
      });
    } catch (err) {
      // If specific attributes fail, try raw query
      console.log(`   ⚠️  Could not query calendars with attributes: ${err.message}`);
      try {
        const [results] = await db.sequelize.query(
          `SELECT id, platform, "recallId", "recallData", "autoRecordExternalEvents", 
           "autoRecordOnlyConfirmedEvents", "updatedAt" 
           FROM calendars ORDER BY "updatedAt" DESC`
        );
        calendars = results.map(row => ({
          id: row.id,
          platform: row.platform,
          recallId: row.recallId,
          recallData: row.recallData,
          autoRecordExternalEvents: row.autoRecordExternalEvents,
          autoRecordOnlyConfirmedEvents: row.autoRecordOnlyConfirmedEvents,
          enableTranscription: undefined,
          transcriptionMode: undefined,
          updatedAt: row.updatedAt,
        }));
      } catch (rawErr) {
        console.log(`   ❌ Could not query calendars: ${rawErr.message}\n`);
      }
    }
    
    if (calendars.length === 0) {
      console.log('   ⚠️  No connected calendars found');
      console.log('   💡 Make sure your calendar is connected via OAuth\n');
    } else {
      console.log(`   ✅ Found ${calendars.length} connected calendar(s):\n`);
      
      for (const calendar of calendars) {
        console.log(`   📧 Calendar: ${calendar.email || calendar.oauthEmail || 'N/A'}`);
        console.log(`      Platform: ${calendar.platform || 'N/A'}`);
        console.log(`      Status: ${calendar.status || 'N/A'}`);
        console.log(`      Recall ID: ${calendar.recallId || 'N/A'}`);
        console.log(`      Auto-record external: ${calendar.autoRecordExternalEvents ? '✅ Yes' : '❌ No'}`);
        console.log(`      Auto-record confirmed only: ${calendar.autoRecordOnlyConfirmedEvents ? '✅ Yes' : '❌ No'}`);
        if (calendar.enableTranscription !== undefined) {
          console.log(`      Transcription enabled: ${calendar.enableTranscription ? '✅ Yes' : '❌ No'}`);
          if (calendar.enableTranscription && calendar.transcriptionMode) {
            console.log(`      Transcription mode: ${calendar.transcriptionMode}`);
          }
        }
        console.log('');
      }
    }
    
    // 3. Check recent calendar events
    console.log('📆 Step 3: Checking recent calendar events...');
    const now = new Date();
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const recentEvents = await db.CalendarEvent.findAll({
      where: {
        startTime: {
          [db.Sequelize.Op.between]: [now, oneWeekFromNow],
        },
      },
      include: [{ model: db.Calendar }],
      order: [['startTime', 'ASC']],
      limit: 10,
    });
    
    if (recentEvents.length === 0) {
      console.log('   ⚠️  No upcoming events found in the next week');
      console.log('   💡 This could mean:');
      console.log('      - No meetings scheduled');
      console.log('      - Calendar events not syncing from Recall.ai');
      console.log('      - Webhooks not being received\n');
    } else {
      console.log(`   ✅ Found ${recentEvents.length} upcoming event(s):\n`);
      
      for (const event of recentEvents) {
        console.log(`   📌 Event: ${event.title || 'Untitled'}`);
        console.log(`      Start: ${event.startTime.toISOString()}`);
        console.log(`      Platform: ${event.platform || 'N/A'}`);
        console.log(`      Meeting URL: ${event.meetingUrl ? '✅ Yes' : '❌ No (required for bot)'}`);
        console.log(`      Should record (automatic): ${event.shouldRecordAutomatic ? '✅ Yes' : '❌ No'}`);
        console.log(`      Should record (manual): ${event.shouldRecordManual ? '✅ Yes' : '❌ No'}`);
        console.log(`      Recall Event ID: ${event.recallId}`);
        
        // Check if bot is scheduled via event's recallData
        if (event.recallId && event.recallData) {
          if (event.recallData.bot_id) {
            console.log(`      Bot ID: ${event.recallData.bot_id}`);
            console.log(`      Bot status: ✅ Scheduled`);
          } else {
            console.log(`      Bot status: ⚠️  Not scheduled`);
            if (event.shouldRecordAutomatic || event.shouldRecordManual) {
              console.log(`      💡 Event should be recorded - bot may be scheduled by worker`);
            }
          }
        } else if (event.shouldRecordAutomatic || event.shouldRecordManual) {
          console.log(`      Bot status: ⚠️  Not yet scheduled (worker should schedule)`);
        }
        console.log('');
      }
    }
    
    // 4. Check webhook configuration
    console.log('🔗 Step 4: Checking webhook configuration...');
    const webhookUrl = process.env.PUBLIC_URL 
      ? `${process.env.PUBLIC_URL}/webhooks/recall-calendar-updates`
      : 'Not set (PUBLIC_URL env var missing)';
    
    console.log(`   Webhook URL: ${webhookUrl}`);
    
    if (calendars.length > 0) {
      console.log(`\n   📋 Calendar webhook URLs configured in Recall.ai:`);
      for (const calendar of calendars) {
        // Try to get calendar details from Recall API
        try {
          Recall.initialize();
          const recallCalendar = await Recall.getCalendar(calendar.recallId);
          if (recallCalendar && recallCalendar.webhook_url) {
            const expectedWebhook = webhookUrl.includes('Not set') ? null : webhookUrl;
            const matches = expectedWebhook && (
              recallCalendar.webhook_url === expectedWebhook || 
              recallCalendar.webhook_url.includes('recall-calendar-updates')
            );
            console.log(`      ${calendar.email}: ${recallCalendar.webhook_url}`);
            if (expectedWebhook) {
              console.log(`         ${matches ? '✅' : '⚠️ '} ${matches ? 'Matches' : 'Does not match'} expected webhook URL`);
            }
          } else {
            console.log(`      ${calendar.email}: ⚠️  No webhook URL configured in Recall.ai`);
          }
        } catch (err) {
          console.log(`      ${calendar.email}: ⚠️  Could not verify webhook URL (${err.message.split('\n')[0]})`);
        }
      }
    }
    console.log('');
    
    // 5. Check recent webhook activity
    console.log('📥 Step 5: Checking recent webhook activity...');
    const recentWebhooks = await db.CalendarWebhook.findAll({
      order: [['receivedAt', 'DESC']],
      limit: 5,
    });
    
    if (recentWebhooks.length === 0) {
      console.log('   ⚠️  No webhooks received recently');
      console.log('   💡 This could mean:');
      console.log('      - Webhook URL not configured in Recall.ai');
      console.log('      - Calendar events not being updated');
      console.log('      - Webhook endpoint not accessible\n');
    } else {
      console.log(`   ✅ Found ${recentWebhooks.length} recent webhook(s):\n`);
      for (const webhook of recentWebhooks) {
        console.log(`   📥 ${webhook.event} at ${webhook.receivedAt.toISOString()}`);
        console.log(`      Calendar ID: ${webhook.calendarId}`);
      }
      console.log('');
    }
    
    // 6. Summary and recommendations
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('📋 SUMMARY & RECOMMENDATIONS\n');
    
    const hasConnectedCalendars = calendars.length > 0;
    const hasUpcomingEvents = recentEvents.length > 0;
    const hasEventsWithRecording = recentEvents.some(e => e.shouldRecordAutomatic || e.shouldRecordManual);
    const hasEventsWithMeetingUrl = recentEvents.some(e => e.meetingUrl);
    const hasWebhooks = recentWebhooks.length > 0;
    
    if (!hasConnectedCalendars) {
      console.log('❌ No connected calendars');
      console.log('   → Connect calendar via OAuth in your V2 app\n');
    }
    
    if (hasConnectedCalendars && !hasUpcomingEvents) {
      console.log('⚠️  Connected calendar but no upcoming events');
      console.log('   → Check if calendar sync is working');
      console.log('   → Verify webhooks are being received\n');
    }
    
    if (hasUpcomingEvents && !hasEventsWithMeetingUrl) {
      console.log('⚠️  Events found but no meeting URLs');
      console.log('   → Bot scheduling requires meeting URLs');
      console.log('   → Check if calendar events have meeting links\n');
    }
    
    if (hasUpcomingEvents && !hasEventsWithRecording) {
      console.log('⚠️  Events found but none set to record');
      const calendar = calendars[0];
      if (!calendar.autoRecordExternalEvents) {
        console.log('   → Enable "Auto-record external events" in calendar settings');
      }
      console.log('   → Or manually set events to record\n');
    }
    
    if (!hasWebhooks) {
      console.log('⚠️  No recent webhook activity');
      console.log('   → Verify webhook URL is configured in Recall.ai calendar settings');
      console.log('   → Check that webhook endpoint is publicly accessible');
      console.log('   → Verify worker is running to process webhooks\n');
    }
    
    if (hasConnectedCalendars && hasUpcomingEvents && hasEventsWithRecording && hasEventsWithMeetingUrl) {
      console.log('✅ Configuration looks good!');
      console.log('   → If bots still not attending, check:');
      console.log('      1. Worker service is running');
      console.log('      2. Worker logs for errors');
      console.log('      3. Recall.ai dashboard for bot status\n');
    }
    
    console.log('💡 To check worker logs on Railway:');
    console.log('   railway logs --service your-worker-service-name\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
  } finally {
    await db.sequelize.close();
  }
}

// Run the check
checkV2BotScheduling().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
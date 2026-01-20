import dotenv from "dotenv";
import db, { connect } from "./db.js";
import Recall from "./services/recall/index.js";

dotenv.config();

/**
 * Check gene@tin.info calendar sync status
 */

async function checkGeneCalendar() {
  console.log('🔍 Checking gene@tin.info calendar sync status\n');
  
  try {
    // Initialize database connection and models
    await connect();
    console.log('✅ Database connected\n');
    
    // Find calendar by email (email is stored in recallData.platform_email)
    const calendars = await db.Calendar.findAll();
    const calendar = calendars.find(c => {
      const email = c.recallData?.platform_email || c.recallData?.email;
      return email && email.includes('gene@tin.info');
    });
    
    if (!calendar) {
      console.log('❌ Calendar not found for gene@tin.info');
      console.log('\n💡 Possible issues:');
      console.log('   - Calendar was never connected');
      console.log('   - Calendar was disconnected');
      console.log('   - Email mismatch in database');
      return;
    }
    
    console.log('✅ Calendar found:');
    console.log(`   ID: ${calendar.id}`);
    console.log(`   Email: ${calendar.email}`);
    console.log(`   Platform: ${calendar.platform}`);
    console.log(`   Status: ${calendar.status}`);
    console.log(`   Recall ID: ${calendar.recallId || 'NULL (not connected to Recall)'}`);
    console.log(`   Created: ${calendar.createdAt}`);
    console.log(`   Updated: ${calendar.updatedAt}`);
    
    if (!calendar.recallId) {
      console.log('\n❌ Calendar has no Recall ID - cannot sync events');
      console.log('💡 Calendar needs to be reconnected via OAuth');
      return;
    }
    
    // Check recent events in database (startTime is virtual, so we need to fetch all and sort)
    const allEvents = await db.CalendarEvent.findAll({
      where: {
        calendarId: calendar.id
      },
      limit: 50
    });
    
    // Sort by startTime (virtual field) in memory
    const recentEvents = allEvents
      .map(e => ({
        ...e.toJSON(),
        startTime: e.startTime,
        title: e.title
      }))
      .sort((a, b) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
        return bTime - aTime; // Descending
      })
      .slice(0, 10);
    
    console.log(`\n📅 Recent events in database: ${recentEvents.length}`);
    for (const event of recentEvents.slice(0, 5)) {
      const startTimeStr = event.startTime ? new Date(event.startTime).toISOString() : 'N/A';
      console.log(`   - ${event.title || 'Untitled'} (${startTimeStr})`);
    }
    
    // Check events from Recall API
    console.log('\n🔗 Fetching events from Recall API...');
    Recall.initialize();
    
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recallEvents = await Recall.fetchCalendarEvents({
      id: calendar.recallId,
      lastUpdatedTimestamp: last24Hours
    });
    
    console.log(`📥 Events from Recall API (last 24h): ${recallEvents.length}`);
    for (const event of recallEvents.slice(0, 5)) {
      const title = event.title || event.raw?.subject || 'Untitled';
      console.log(`   - ${title} (${event.start_time || 'N/A'})`);
    }
    
    // Compare
    const dbEventIds = new Set(recentEvents.map(e => e.recallId));
    const recallEventIds = new Set(recallEvents.map(e => e.id));
    const missingInDb = recallEvents.filter(e => !dbEventIds.has(e.id));
    
    if (missingInDb.length > 0) {
      console.log(`\n⚠️  ${missingInDb.length} event(s) in Recall but not in database:`);
      for (const event of missingInDb.slice(0, 5)) {
        console.log(`   - ${event.title || event.raw?.subject || 'Untitled'} (${event.id})`);
      }
      console.log('\n💡 These events should be synced by periodic sync or webhooks');
    } else {
      console.log('\n✅ All Recall events appear to be in database');
    }
    
    // Check webhooks
    const recentWebhooks = await db.CalendarWebhook.findAll({
      where: {
        calendarId: calendar.id
      },
      order: [['receivedAt', 'DESC']],
      limit: 5
    });
    
    console.log(`\n📥 Recent webhooks: ${recentWebhooks.length}`);
    for (const webhook of recentWebhooks) {
      console.log(`   - ${webhook.event} at ${webhook.receivedAt.toISOString()}`);
    }
    
    if (recentWebhooks.length === 0) {
      console.log('\n⚠️  No recent webhooks - calendar may not be receiving updates from Recall');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
  } finally {
    await db.sequelize.close();
  }
}

checkGeneCalendar().catch(console.error);


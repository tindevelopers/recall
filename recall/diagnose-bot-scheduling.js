import dotenv from "dotenv";
import db from "./db.js";
import { backgroundQueue } from "./queue.js";

dotenv.config();

/**
 * Diagnostic script to check why bots aren't being scheduled.
 * Checks:
 * 1. Worker/Redis connection
 * 2. Queued jobs status
 * 3. Calendar events that should have bots scheduled
 * 4. Recent job processing activity
 */

async function diagnoseBotScheduling() {
  console.log('🔍 Diagnosing Bot Scheduling Issues\n');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Redis URL: ${process.env.REDIS_URL ? 'configured' : '❌ NOT SET'}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'configured' : '❌ NOT SET'}\n`);

  if (!process.env.REDIS_URL) {
    console.log('❌ REDIS_URL is required for background jobs');
    console.log('   Worker cannot process jobs without Redis connection\n');
    return;
  }

  try {
    // 1. Check Redis/Queue connection
    console.log('📊 Step 1: Checking Redis/Queue connection...');
    try {
      await backgroundQueue.client.ping();
      console.log('   ✅ Redis connection successful\n');
    } catch (err) {
      console.log(`   ❌ Redis connection failed: ${err.message}\n`);
      return;
    }

    // 2. Check queued jobs
    console.log('📋 Step 2: Checking queued jobs...');
    try {
      const waitingJobs = await backgroundQueue.getWaiting();
      const activeJobs = await backgroundQueue.getActive();
      const failedJobs = await backgroundQueue.getFailed();
      const completedJobs = await backgroundQueue.getCompleted();

      const botScheduleWaiting = waitingJobs.filter(j => j.name === 'calendarevent.update_bot_schedule');
      const botScheduleActive = activeJobs.filter(j => j.name === 'calendarevent.update_bot_schedule');
      const botScheduleFailed = failedJobs.filter(j => j.name === 'calendarevent.update_bot_schedule');

      console.log(`   Total waiting jobs: ${waitingJobs.length}`);
      console.log(`   Total active jobs: ${activeJobs.length}`);
      console.log(`   Total failed jobs: ${failedJobs.length}`);
      console.log(`   Total completed jobs: ${completedJobs.length}`);
      console.log(`\n   Bot scheduling jobs:`);
      console.log(`      Waiting: ${botScheduleWaiting.length}`);
      console.log(`      Active: ${botScheduleActive.length}`);
      console.log(`      Failed: ${botScheduleFailed.length}`);

      if (botScheduleFailed.length > 0) {
        console.log(`\n   ⚠️  Failed bot scheduling jobs:`);
        for (const job of botScheduleFailed.slice(0, 5)) {
          console.log(`      Job ${job.id}: ${job.failedReason || 'Unknown error'}`);
          console.log(`         Data: ${JSON.stringify(job.data)}`);
        }
      }

      if (botScheduleWaiting.length > 0) {
        console.log(`\n   ⚠️  Bot scheduling jobs are waiting (may indicate worker not processing):`);
        for (const job of botScheduleWaiting.slice(0, 5)) {
          console.log(`      Job ${job.id}: recallEventId=${job.data.recallEventId}`);
        }
      }
      console.log('');

    } catch (err) {
      console.log(`   ⚠️  Could not check queue status: ${err.message}\n`);
    }

    // 3. Check database connection
    console.log('💾 Step 3: Checking database connection...');
    try {
      await db.sequelize.authenticate();
      console.log('   ✅ Database connection successful\n');
    } catch (err) {
      console.log(`   ❌ Database connection failed: ${err.message}\n`);
      return;
    }

    // 4. Check calendar events that should have bots scheduled
    console.log('📅 Step 4: Checking calendar events that should have bots...');
    const now = new Date();
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const eventsNeedingBots = await db.CalendarEvent.findAll({
      where: {
        startTime: {
          [db.Sequelize.Op.between]: [now, oneWeekFromNow],
        },
        [db.Sequelize.Op.or]: [
          { shouldRecordAutomatic: true },
          { shouldRecordManual: true },
        ],
      },
      include: [{ model: db.Calendar }],
      order: [['startTime', 'ASC']],
      limit: 20,
    });

    console.log(`   Found ${eventsNeedingBots.length} upcoming events that should be recorded\n`);

    if (eventsNeedingBots.length === 0) {
      console.log('   ⚠️  No events found that should have bots scheduled');
      console.log('   💡 Check:');
      console.log('      - Are there upcoming meetings?');
      console.log('      - Are calendar auto-record settings enabled?');
      console.log('      - Do events have meeting URLs?\n');
    } else {
      let eventsWithoutBots = 0;
      let eventsWithoutMeetingUrl = 0;
      let eventsInPast = 0;

      for (const event of eventsNeedingBots) {
        const hasBot = event.recallData?.bot_id || (event.recallData?.bots || []).length > 0;
        const hasMeetingUrl = !!event.meetingUrl;
        const isFuture = event.startTime > now;

        if (!hasBot && hasMeetingUrl && isFuture) {
          eventsWithoutBots++;
          console.log(`   ⚠️  Event "${event.title || 'Untitled'}" (${event.id})`);
          console.log(`      Start: ${event.startTime.toISOString()}`);
          console.log(`      Recall ID: ${event.recallId}`);
          console.log(`      Should record: automatic=${event.shouldRecordAutomatic}, manual=${event.shouldRecordManual}`);
          console.log(`      Meeting URL: ${hasMeetingUrl ? '✅' : '❌'}`);
          console.log(`      Bot scheduled: ❌`);
          console.log(`      💡 This event should have a bot scheduled but doesn't\n`);
        }

        if (!hasMeetingUrl) {
          eventsWithoutMeetingUrl++;
        }

        if (!isFuture) {
          eventsInPast++;
        }
      }

      if (eventsWithoutBots === 0 && eventsNeedingBots.length > 0) {
        console.log('   ✅ All events that should have bots appear to have them scheduled\n');
      }

      if (eventsWithoutMeetingUrl > 0) {
        console.log(`   ⚠️  ${eventsWithoutMeetingUrl} event(s) missing meeting URLs (required for bot scheduling)\n`);
      }

      if (eventsInPast > 0) {
        console.log(`   ℹ️  ${eventsInPast} event(s) are in the past (bots won't be scheduled for past events)\n`);
      }
    }

    // 5. Check periodic sync job
    console.log('⏰ Step 5: Checking periodic sync job...');
    try {
      const repeatableJobs = await backgroundQueue.getRepeatableJobs();
      const periodicSync = repeatableJobs.find(j => j.name === 'periodic.calendar.sync');

      if (periodicSync) {
        console.log(`   ✅ Periodic sync job is scheduled`);
        console.log(`      Pattern: ${periodicSync.pattern || 'N/A'}`);
        console.log(`      Next run: ${periodicSync.next ? new Date(periodicSync.next).toISOString() : 'N/A'}\n`);
      } else {
        console.log(`   ⚠️  Periodic sync job NOT found`);
        console.log(`   💡 Worker should schedule this on startup\n`);
      }
    } catch (err) {
      console.log(`   ⚠️  Could not check repeatable jobs: ${err.message}\n`);
    }

    // 6. Summary and recommendations
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('📋 DIAGNOSIS SUMMARY\n');

    const recommendations = [];

    if (!process.env.REDIS_URL) {
      recommendations.push('❌ Set REDIS_URL environment variable');
    }

    try {
      const failedJobs = await backgroundQueue.getFailed();
      const botScheduleFailed = failedJobs.filter(j => j.name === 'calendarevent.update_bot_schedule');
      if (botScheduleFailed.length > 0) {
        recommendations.push(`⚠️  ${botScheduleFailed.length} bot scheduling job(s) failed - check worker logs`);
      }
    } catch (err) {
      // Ignore
    }

    try {
      const waitingJobs = await backgroundQueue.getWaiting();
      const botScheduleWaiting = waitingJobs.filter(j => j.name === 'calendarevent.update_bot_schedule');
      if (botScheduleWaiting.length > 10) {
        recommendations.push(`⚠️  ${botScheduleWaiting.length} bot scheduling jobs waiting - worker may not be processing`);
      }
    } catch (err) {
      // Ignore
    }

    if (recommendations.length === 0) {
      console.log('✅ No obvious issues found');
      console.log('\n💡 If bots still aren\'t being scheduled:');
      console.log('   1. Check worker logs: railway logs --service recall-worker --tail 100');
      console.log('   2. Verify worker is running: railway status');
      console.log('   3. Check for errors in worker logs');
      console.log('   4. Verify events have meeting URLs');
      console.log('   5. Check calendar auto-record settings\n');
    } else {
      console.log('Issues found:\n');
      recommendations.forEach(rec => console.log(`   ${rec}`));
      console.log('\n💡 Next steps:');
      console.log('   1. Check worker logs: railway logs --service recall-worker --tail 100');
      console.log('   2. Verify worker is running and processing jobs');
      console.log('   3. Check Redis connection');
      console.log('   4. Review failed jobs for error details\n');
    }

  } catch (error) {
    console.error('\n❌ Error during diagnosis:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
  } finally {
    await db.sequelize.close();
    await backgroundQueue.close();
  }
}

// Run the diagnosis
diagnoseBotScheduling().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});


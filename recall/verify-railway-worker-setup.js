import { execSync } from "child_process";

/**
 * Verify Railway worker service setup
 * This script helps diagnose if worker service exists and is configured correctly
 */

console.log('🔍 Verifying Railway Worker Setup\n');

try {
  // Check Railway status
  console.log('📋 Step 1: Checking Railway project status...');
  const status = execSync('railway status', { encoding: 'utf8', stdio: 'pipe' });
  console.log(status);
  
  // Try to get all services (may require interactive prompt)
  console.log('\n📋 Step 2: Checking for worker service...');
  try {
    // Try to list services - this might fail if service doesn't exist
    const serviceCheck = execSync('railway service recall-worker 2>&1', { encoding: 'utf8', stdio: 'pipe' });
    if (serviceCheck.includes('not found')) {
      console.log('❌ Worker service "recall-worker" not found');
      console.log('\n💡 To create the worker service:');
      console.log('   1. Go to Railway Dashboard: https://railway.app');
      console.log('   2. Open your project');
      console.log('   3. Click "+ New" → "Empty Service"');
      console.log('   4. Name it: recall-worker');
      console.log('   5. Connect to GitHub repository');
      console.log('   6. Set Start Command: npm run start:worker');
      console.log('   7. Copy environment variables from main service');
    } else {
      console.log('✅ Worker service found');
      console.log(serviceCheck);
    }
  } catch (err) {
    console.log('⚠️  Could not check service (may need to create it)');
    console.log('   Error:', err.message.split('\n')[0]);
  }
  
  // Check environment variables
  console.log('\n📋 Step 3: Checking REDIS_URL...');
  try {
    const vars = execSync('railway variables 2>&1', { encoding: 'utf8', stdio: 'pipe' });
    if (vars.includes('REDIS_URL')) {
      console.log('✅ REDIS_URL is configured');
      const redisMatch = vars.match(/REDIS_URL[^\n]+/);
      if (redisMatch) {
        const masked = redisMatch[0].replace(/:[^:@]+@/, ':****@');
        console.log(`   ${masked.substring(0, 80)}`);
      }
    } else {
      console.log('❌ REDIS_URL not found');
      console.log('💡 Add Redis service in Railway dashboard');
    }
  } catch (err) {
    console.log('⚠️  Could not check variables:', err.message.split('\n')[0]);
  }
  
  // Try to get worker logs
  console.log('\n📋 Step 4: Checking worker logs...');
  try {
    const logs = execSync('railway logs --service recall-worker --tail 30 2>&1', { encoding: 'utf8', stdio: 'pipe' });
    
    const hasRedisReady = logs.includes('Redis connection established') || logs.includes('Queue is ready');
    const hasPeriodicSync = logs.includes('periodic calendar sync') || logs.includes('Scheduled periodic');
    const hasWorkerStart = logs.includes('Starting recall worker') || logs.includes('Worker startup');
    const hasRedisError = logs.includes('ECONNREFUSED') || (logs.includes('Redis') && logs.includes('error'));
    
    console.log('\n📊 Log Analysis:');
    console.log(`   Worker started: ${hasWorkerStart ? '✅' : '❌'}`);
    console.log(`   Redis connected: ${hasRedisReady ? '✅' : '❌'}`);
    console.log(`   Periodic sync scheduled: ${hasPeriodicSync ? '✅' : '❌'}`);
    console.log(`   Redis errors: ${hasRedisError ? '⚠️  Yes' : '✅ No'}`);
    
    if (hasRedisError && !hasRedisReady) {
      console.log('\n❌ ISSUE: Redis connection errors');
      console.log('💡 Check REDIS_URL is set correctly in worker service');
    }
    
    if (!hasPeriodicSync && hasRedisReady) {
      console.log('\n⚠️  Periodic sync not found in recent logs');
      console.log('💡 Wait 2-3 minutes for first sync to run');
    }
    
    // Show recent logs
    console.log('\n📄 Recent log lines:');
    const lines = logs.split('\n').slice(-8);
    lines.forEach(line => {
      if (line.trim() && !line.includes('Service')) {
        console.log(`   ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
      }
    });
    
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('Service')) {
      console.log('❌ Worker service not found - needs to be created');
    } else {
      console.log('⚠️  Could not fetch logs:', err.message.split('\n')[0]);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
  console.log('📋 NEXT STEPS\n');
  console.log('If worker service doesn\'t exist:');
  console.log('1. Create it in Railway dashboard (see instructions above)');
  console.log('2. Set Start Command: npm run start:worker');
  console.log('3. Copy all environment variables from main service');
  console.log('4. Wait for deployment');
  console.log('5. Check logs: railway logs --service recall-worker --tail 50');
  console.log('\nIf worker service exists but has issues:');
  console.log('1. Check REDIS_URL is set');
  console.log('2. Verify start command is npm run start:worker');
  console.log('3. Check logs for errors');
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
}


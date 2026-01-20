import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();

/**
 * Check if Railway worker service is connected and working
 * This script verifies the worker can connect to shared resources
 */

console.log('🔍 Checking Railway Worker Connection\n');

try {
  // Check Railway status
  console.log('📋 Step 1: Railway Project Status');
  const status = execSync('railway status', { encoding: 'utf8', stdio: 'pipe' });
  console.log(status);
  
  // Try different possible worker service names
  const possibleNames = ['recall-worker', 'v2-worker', 'worker', 'recall-v2-worker'];
  let workerServiceFound = false;
  let workerServiceName = null;
  
  console.log('\n📋 Step 2: Looking for worker service...');
  for (const name of possibleNames) {
    try {
      const check = execSync(`railway service ${name} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
      if (!check.includes('not found') && !check.includes('Failed')) {
        console.log(`✅ Found worker service: ${name}`);
        workerServiceFound = true;
        workerServiceName = name;
        break;
      }
    } catch (err) {
      // Continue checking other names
    }
  }
  
  if (!workerServiceFound) {
    console.log('⚠️  Worker service not found via CLI');
    console.log('💡 The service may exist in Railway dashboard but not be linked via CLI');
    console.log('💡 Check Railway dashboard: https://railway.app');
    console.log('💡 Or try: railway service <service-name> to link to it');
    console.log('\n📋 To link to worker service:');
    console.log('   1. Go to Railway dashboard');
    console.log('   2. Find the worker service name');
    console.log('   3. Run: railway service <service-name>');
    process.exit(0);
  }
  
  // Check worker logs
  console.log(`\n📋 Step 3: Checking ${workerServiceName} logs...`);
  try {
    const logs = execSync(`railway logs --service ${workerServiceName} --tail 100 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
    
    // Analyze logs
    const hasRedisReady = logs.includes('Redis connection established') || logs.includes('Queue is ready');
    const hasPeriodicSync = logs.includes('periodic calendar sync') || logs.includes('Scheduled periodic');
    const hasWorkerStart = logs.includes('Starting recall worker') || logs.includes('Worker startup');
    const hasRedisError = logs.includes('ECONNREFUSED') || (logs.includes('Redis') && logs.includes('error'));
    const hasDatabaseConnected = logs.includes('Database connection established');
    const isRunningMainApp = logs.includes('Server ready at http://0.0.0.0:3003');
    
    console.log('\n📊 Worker Status Analysis:');
    console.log(`   Service name: ${workerServiceName}`);
    console.log(`   Worker started: ${hasWorkerStart ? '✅' : '❌'}`);
    console.log(`   Database connected: ${hasDatabaseConnected ? '✅' : '❌'}`);
    console.log(`   Redis connected: ${hasRedisReady ? '✅' : '❌'}`);
    console.log(`   Periodic sync scheduled: ${hasPeriodicSync ? '✅' : '❌'}`);
    console.log(`   Running main app (wrong): ${isRunningMainApp ? '❌ YES - WRONG!' : '✅ No'}`);
    console.log(`   Redis errors: ${hasRedisError ? '⚠️  Yes' : '✅ No'}`);
    
    if (isRunningMainApp) {
      console.log('\n❌ ISSUE: Worker is running main app instead of worker!');
      console.log('💡 Fix: Set Start Command to: npm run start:worker');
    }
    
    if (hasRedisError && !hasRedisReady) {
      console.log('\n❌ ISSUE: Redis connection errors');
      console.log('💡 Check REDIS_URL is set in worker service');
    }
    
    if (!hasPeriodicSync && hasRedisReady) {
      console.log('\n⚠️  Periodic sync not found in logs');
      console.log('💡 This may be normal if worker just started');
      console.log('💡 Wait 2-3 minutes and check again');
    }
    
    // Show recent logs
    console.log('\n📄 Recent worker logs:');
    const lines = logs.split('\n').slice(-15);
    lines.forEach(line => {
      if (line.trim() && !line.includes('Service')) {
        const preview = line.substring(0, 120);
        console.log(`   ${preview}${line.length > 120 ? '...' : ''}`);
      }
    });
    
  } catch (err) {
    console.log('⚠️  Could not fetch worker logs:', err.message.split('\n')[0]);
  }
  
  // Check environment variables match
  console.log('\n📋 Step 4: Checking environment variables...');
  try {
    const mainVars = execSync('railway variables 2>&1', { encoding: 'utf8', stdio: 'pipe' });
    const workerVars = execSync(`railway variables --service ${workerServiceName} 2>&1`, { encoding: 'utf8', stdio: 'pipe' });
    
    const mainRedis = mainVars.match(/REDIS_URL[^\n]+/);
    const workerRedis = workerVars.match(/REDIS_URL[^\n]+/);
    
    if (mainRedis && workerRedis) {
      const mainRedisUrl = mainRedis[0].replace(/:[^:@]+@/, ':****@');
      const workerRedisUrl = workerRedis[0].replace(/:[^:@]+@/, ':****@');
      
      console.log(`   Main service REDIS_URL: ${mainRedisUrl.substring(0, 60)}...`);
      console.log(`   Worker service REDIS_URL: ${workerRedisUrl.substring(0, 60)}...`);
      
      // Compare (rough check - just see if they're similar)
      if (mainRedis[0].includes('redis.railway') && workerRedis[0].includes('redis.railway')) {
        console.log('   ✅ Both services appear to use Railway Redis');
      } else {
        console.log('   ⚠️  Redis URLs may differ - verify they point to same Redis instance');
      }
    } else {
      console.log('   ⚠️  Could not compare REDIS_URL');
    }
    
    const mainDb = mainVars.match(/DATABASE_URL[^\n]+/);
    const workerDb = workerVars.match(/DATABASE_URL[^\n]+/);
    
    if (mainDb && workerDb) {
      console.log('   ✅ Both services have DATABASE_URL');
    } else {
      console.log('   ⚠️  DATABASE_URL may be missing in one service');
    }
    
  } catch (err) {
    console.log('   ⚠️  Could not compare environment variables:', err.message.split('\n')[0]);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
  console.log('📋 SUMMARY\n');
  console.log('If worker is running correctly, you should see:');
  console.log('  ✅ Redis connection established');
  console.log('  ✅ Periodic sync scheduled');
  console.log('  ✅ No "Server ready" message (that means main app)');
  console.log('\nIf issues found, check:');
  console.log('  1. Start Command is: npm run start:worker');
  console.log('  2. REDIS_URL matches main service');
  console.log('  3. All environment variables copied from main service');
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
}


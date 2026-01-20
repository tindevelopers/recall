import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();

/**
 * Check Railway worker status and diagnose calendar sync issues
 * This script checks Railway logs and environment to diagnose production issues
 */

async function checkRailwayWorker() {
  console.log('🔍 Checking Railway Worker Status\n');
  
  try {
    // Check if Railway CLI is available
    try {
      execSync('railway --version', { stdio: 'ignore' });
    } catch (err) {
      console.log('❌ Railway CLI not found. Install with: npm i -g @railway/cli');
      return;
    }
    
    // Check current Railway project/service
    console.log('📋 Step 1: Checking Railway project status...');
    try {
      const status = execSync('railway status', { encoding: 'utf8' });
      console.log(status);
    } catch (err) {
      console.log('⚠️  Could not get Railway status:', err.message);
    }
    
    // Check for worker service
    console.log('\n📋 Step 2: Checking for worker service...');
    try {
      const services = execSync('railway service', { encoding: 'utf8' });
      console.log(services);
      
      if (services.includes('recall-worker') || services.includes('worker')) {
        console.log('✅ Worker service found');
      } else {
        console.log('⚠️  Worker service not found. You may need to create it.');
      }
    } catch (err) {
      console.log('⚠️  Could not list services:', err.message);
    }
    
    // Check REDIS_URL environment variable
    console.log('\n📋 Step 3: Checking REDIS_URL...');
    try {
      const vars = execSync('railway variables', { encoding: 'utf8' });
      const redisMatch = vars.match(/REDIS_URL[=\s]+([^\s]+)/i);
      if (redisMatch) {
        const redisUrl = redisMatch[1];
        const maskedUrl = redisUrl.replace(/:[^:@]+@/, ':****@');
        console.log(`✅ REDIS_URL is set: ${maskedUrl}`);
      } else {
        console.log('❌ REDIS_URL not found in environment variables');
        console.log('💡 You need to add a Redis service in Railway dashboard');
      }
    } catch (err) {
      console.log('⚠️  Could not check environment variables:', err.message);
    }
    
    // Check worker logs
    console.log('\n📋 Step 4: Checking worker logs (last 50 lines)...');
    try {
      const logs = execSync('railway logs --service recall-worker --tail 50', { encoding: 'utf8' });
      
      // Check for key indicators
      const hasRedisReady = logs.includes('Redis connection established') || logs.includes('Queue is ready');
      const hasPeriodicSync = logs.includes('periodic calendar sync') || logs.includes('Scheduled periodic');
      const hasRedisError = logs.includes('ECONNREFUSED') || logs.includes('Redis') && logs.includes('error');
      const hasWorkerStart = logs.includes('Starting recall worker') || logs.includes('Worker startup');
      
      console.log('\n📊 Log Analysis:');
      console.log(`   Worker started: ${hasWorkerStart ? '✅' : '❌'}`);
      console.log(`   Redis connected: ${hasRedisReady ? '✅' : '❌'}`);
      console.log(`   Periodic sync scheduled: ${hasPeriodicSync ? '✅' : '❌'}`);
      console.log(`   Redis errors: ${hasRedisError ? '⚠️  Yes' : '✅ No'}`);
      
      if (hasRedisError && !hasRedisReady) {
        console.log('\n❌ ISSUE FOUND: Redis connection errors detected');
        console.log('💡 Fix: Ensure REDIS_URL is set and Redis service is running');
      }
      
      if (!hasPeriodicSync && hasRedisReady) {
        console.log('\n⚠️  Periodic sync not found in logs');
        console.log('💡 This may be normal if worker just started');
      }
      
      // Show recent log lines
      console.log('\n📄 Recent log lines:');
      const lines = logs.split('\n').slice(-10);
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`   ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
        }
      });
      
    } catch (err) {
      if (err.message.includes('not found') || err.message.includes('Service')) {
        console.log('❌ Worker service not found');
        console.log('💡 Create worker service: railway add --service recall-worker');
      } else {
        console.log('⚠️  Could not fetch logs:', err.message);
      }
    }
    
    // Summary and recommendations
    console.log('\n═══════════════════════════════════════════════════════════════\n');
    console.log('📋 SUMMARY & RECOMMENDATIONS\n');
    
    console.log('To fix calendar sync issues:');
    console.log('1. Ensure worker service exists: railway service');
    console.log('2. Check REDIS_URL is set: railway variables | grep REDIS');
    console.log('3. If REDIS_URL missing, add Redis service in Railway dashboard');
    console.log('4. Verify worker logs show Redis connection: railway logs --service recall-worker');
    console.log('5. Look for "Redis connection established" and "Scheduled periodic calendar sync"');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

checkRailwayWorker().catch(console.error);


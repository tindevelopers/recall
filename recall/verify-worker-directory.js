import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Verification script to check if worker is running from correct directory
 * This helps diagnose if Railway is building from the right location
 */

console.log('🔍 Verifying Worker Directory Configuration\n');

// Check current working directory
const cwd = process.cwd();
console.log(`Current working directory: ${cwd}`);

// Check if we're in the recall subdirectory or root
const isInRecallDir = cwd.endsWith('recall') || cwd.includes('/recall');
console.log(`Running from recall directory: ${isInRecallDir ? '✅ Yes' : '❌ No'}`);

// Check for key files
const keyFiles = [
  'package.json',
  'worker/index.js',
  'db.js',
  'queue.js',
  'services/recall/index.js',
];

console.log('\n📁 Checking for required files:');
let allFilesExist = true;

for (const file of keyFiles) {
  const filePath = path.join(cwd, file);
  const exists = fs.existsSync(filePath);
  const status = exists ? '✅' : '❌';
  console.log(`   ${status} ${file}`);
  if (!exists) {
    allFilesExist = false;
  }
}

// Check package.json
console.log('\n📦 Checking package.json:');
try {
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  console.log(`   Name: ${packageJson.name}`);
  console.log(`   Has start:worker script: ${packageJson.scripts?.['start:worker'] ? '✅ Yes' : '❌ No'}`);
  
  if (packageJson.scripts?.['start:worker']) {
    console.log(`   Start worker command: ${packageJson.scripts['start:worker']}`);
  }
} catch (err) {
  console.log(`   ❌ Could not read package.json: ${err.message}`);
}

// Check worker/index.js exists
console.log('\n🔧 Checking worker files:');
const workerIndexPath = path.join(cwd, 'worker', 'index.js');
const workerExists = fs.existsSync(workerIndexPath);
console.log(`   Worker index.js: ${workerExists ? '✅ Found' : '❌ Missing'}`);

if (workerExists) {
  try {
    const workerContent = fs.readFileSync(workerIndexPath, 'utf8');
    const hasDbImport = workerContent.includes("from '../db.js'");
    const hasQueueImport = workerContent.includes("from '../queue.js'");
    
    console.log(`   Imports db.js: ${hasDbImport ? '✅ Yes' : '❌ No'}`);
    console.log(`   Imports queue.js: ${hasQueueImport ? '✅ Yes' : '❌ No'}`);
    
    if (!hasDbImport || !hasQueueImport) {
      console.log(`   ⚠️  Worker imports suggest it expects to be in recall/ directory`);
    }
  } catch (err) {
    console.log(`   ⚠️  Could not read worker/index.js: ${err.message}`);
  }
}

// Summary
console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('📋 SUMMARY\n');

if (allFilesExist) {
  console.log('✅ All required files found - worker should run correctly');
} else {
  console.log('❌ Some required files are missing');
  console.log('\n💡 Possible issues:');
  console.log('   1. Railway is building from wrong directory');
  console.log('   2. Root Directory not set correctly in Railway dashboard');
  console.log('   3. Dockerfile.worker not copying files correctly');
}

if (!isInRecallDir && allFilesExist) {
  console.log('\n✅ Worker appears to be running correctly from root directory');
  console.log('   (Files copied correctly by Dockerfile.worker)');
} else if (isInRecallDir && allFilesExist) {
  console.log('\n✅ Worker is running from recall directory');
  console.log('   (Root Directory set to "recall" in Railway)');
}

console.log('\n💡 Railway Configuration:');
console.log('   - Root Directory: Should be root OR recall (both work with updated Dockerfile)');
console.log('   - Start Command: npm run start:worker');
console.log('   - Dockerfile: recall/Dockerfile.worker');


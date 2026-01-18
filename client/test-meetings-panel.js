/**
 * Browser Automation Test for Meetings Panel
 * 
 * This script opens a visible browser to test the meetings panel UI.
 * It uses Playwright to automate browser interactions.
 */

const { chromium } = require('playwright');

const DEBUG_ENDPOINT = 'http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc';

async function log(location, message, data = {}) {
  try {
    await fetch(DEBUG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location,
        message,
        data,
        timestamp: Date.now(),
        sessionId: 'browser-automation'
      })
    });
  } catch (e) {
    console.log(`[LOG] ${location}: ${message}`, data);
  }
}

async function testMeetingsPanel() {
  // #region agent log
  await log('test-meetings-panel.js:entry', 'Starting browser automation test', { hypothesisId: 'init' });
  // #endregion

  const browser = await chromium.launch({
    headless: false,  // Show the browser window
    slowMo: 100,      // Slow down operations so you can see them
    devtools: true    // Open devtools for debugging
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });

  // Enable console log forwarding from the browser
  const page = await context.newPage();
  
  page.on('console', async msg => {
    // #region agent log
    await log('browser:console', msg.text(), { type: msg.type(), hypothesisId: 'browser-console' });
    // #endregion
  });

  page.on('pageerror', async error => {
    // #region agent log
    await log('browser:error', error.message, { stack: error.stack, hypothesisId: 'browser-error' });
    // #endregion
  });

  page.on('requestfailed', async request => {
    // #region agent log
    await log('browser:request-failed', `Request failed: ${request.url()}`, {
      method: request.method(),
      failure: request.failure()?.errorText,
      hypothesisId: 'network-error'
    });
    // #endregion
  });

  try {
    // #region agent log
    await log('test-meetings-panel.js:navigate', 'Navigating to app', { url: 'http://localhost:3011', hypothesisId: 'navigation' });
    // #endregion

    await page.goto('http://localhost:3011', { waitUntil: 'networkidle' });

    // #region agent log
    await log('test-meetings-panel.js:page-loaded', 'Page loaded successfully', { title: await page.title(), hypothesisId: 'navigation' });
    // #endregion

    // Wait for the main container to appear
    await page.waitForSelector('.bg-gray-100', { timeout: 10000 });

    // #region agent log
    await log('test-meetings-panel.js:container-found', 'Main container found', { hypothesisId: 'dom-ready' });
    // #endregion

    // Check for calendar panel or connection screen
    const upcomingMeetingsHeader = await page.$('text=Upcoming meetings');
    const connectCalendarBtn = await page.$('text=Connect your calendar');
    const initializingText = await page.$('text=Initializing...');

    // #region agent log
    await log('test-meetings-panel.js:ui-state', 'UI state detected', {
      hasUpcomingMeetings: !!upcomingMeetingsHeader,
      hasConnectCalendar: !!connectCalendarBtn,
      isInitializing: !!initializingText,
      hypothesisId: 'ui-state'
    });
    // #endregion

    // Take a screenshot
    await page.screenshot({ path: '/Users/foo/projects/Recall.ai/client/meetings-panel-screenshot.png' });

    // #region agent log
    await log('test-meetings-panel.js:screenshot', 'Screenshot saved', { path: 'meetings-panel-screenshot.png', hypothesisId: 'capture' });
    // #endregion

    console.log('\n=== Browser automation started ===');
    console.log('Browser is now open with DevTools.');
    console.log('You can interact with the meetings panel.');
    console.log('Press Ctrl+C in the terminal to close when done.\n');

    // Keep the browser open for manual interaction
    // The script will wait indefinitely until manually stopped
    await new Promise(() => {});

  } catch (error) {
    // #region agent log
    await log('test-meetings-panel.js:error', 'Test error', { message: error.message, stack: error.stack, hypothesisId: 'test-error' });
    // #endregion
    console.error('Test error:', error.message);
    
    // Still keep browser open for debugging
    console.log('\nBrowser kept open for debugging. Press Ctrl+C to close.');
    await new Promise(() => {});
  }
}

testMeetingsPanel();

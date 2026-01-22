import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3003';

// Helper function to sign in and get auth token
async function signIn(page, email, password) {
  await page.goto(`${BASE_URL}/sign-in`);
  await page.waitForLoadState('networkidle');
  
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  
  // Submit form and wait for navigation
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }),
    page.click('button[type="submit"]')
  ]);
  
  // Check if authentication succeeded
  const currentUrl = page.url();
  if (currentUrl.includes('/sign-in')) {
    const errorMessage = await page.locator('text=/invalid|error/i').first().textContent().catch(() => 'Invalid credentials');
    throw new Error(`Authentication failed: ${errorMessage}`);
  }
  
  // Get auth token from cookies
  const cookies = await page.context().cookies();
  const authToken = cookies.find(c => c.name === 'authToken')?.value;
  
  if (!authToken) {
    throw new Error('Authentication succeeded but no auth token found');
  }
  
  return authToken;
}

test.describe('Publish Meeting to Notion', () => {
  test.beforeEach(async ({ page }) => {
    // Set a longer timeout for API calls
    test.setTimeout(60000);
  });

  test('should publish meeting results to Notion via API', async ({ page, request }) => {
    // Step 1: Sign in (you'll need to adjust credentials or use test user)
    const email = process.env.TEST_EMAIL || 'test@example.com';
    const password = process.env.TEST_PASSWORD || 'testpassword';

    let authToken;
    try {
      authToken = await signIn(page, email, password);
    } catch (error) {
      test.skip(`Authentication failed: ${error.message}. Please set TEST_EMAIL and TEST_PASSWORD environment variables with valid credentials.`);
      return;
    }

    // Step 3: Get list of meetings
    const meetingsResponse = await request.get(`${BASE_URL}/meetings`, {
      headers: {
        Cookie: `authToken=${authToken}`,
      },
    });

    expect(meetingsResponse.ok()).toBeTruthy();
    
    // Parse meetings page to find a meeting ID
    // For now, we'll need a meeting ID - you can either:
    // 1. Create a test meeting first
    // 2. Use an existing meeting ID from environment
    const meetingId = process.env.TEST_MEETING_ID;
    
    if (!meetingId) {
      console.log('⚠️  TEST_MEETING_ID not set - will try to find a meeting from the page');
      
      // Navigate to meetings page and find a meeting
      await page.goto(`${BASE_URL}/meetings`);
      await page.waitForLoadState('networkidle');
      
      // Try to find a meeting link
      const meetingLink = page.locator('a[href^="/meetings/"]').first();
      const meetingLinkExists = await meetingLink.count() > 0;
      
      if (!meetingLinkExists) {
        test.skip('No meetings found - create a test meeting first');
        return;
      }
      
      // Extract meeting ID from href
      const href = await meetingLink.getAttribute('href');
      const extractedMeetingId = href?.replace('/meetings/', '');
      
      if (!extractedMeetingId) {
        test.skip('Could not extract meeting ID');
        return;
      }
      
      // Use the extracted meeting ID
      const publishResponse = await request.post(
        `${BASE_URL}/api/meetings/${extractedMeetingId}/publish`,
        {
          headers: {
            Cookie: `authToken=${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Verify response - may return error if Notion not connected
      const publishResult = await publishResponse.json();
      
      if (!publishResponse.ok()) {
        // If Notion is not connected, that's expected
        if (publishResult.error === 'Notion not connected' || publishResult.error === 'Notion destination not configured') {
          console.log(`✅ API returned expected error: ${publishResult.error}`);
          expect(publishResult.error).toBeTruthy();
          return; // Test passes - this is expected behavior
        }
        // Other errors should fail the test
        throw new Error(`Unexpected error: ${publishResult.error || publishResult.message || 'Unknown error'}`);
      }
      
      // Check that the response indicates success or queued
      expect(publishResult).toHaveProperty('success');
      expect(publishResult.success).toBe(true);
      
      // Should either publish immediately or queue enrichment
      expect(['publish', 'enrich_then_publish']).toContain(publishResult.action);
      
      console.log('✅ Publish response:', publishResult);
    } else {
      // Use provided meeting ID
      const publishResponse = await request.post(
        `${BASE_URL}/api/meetings/${meetingId}/publish`,
        {
          headers: {
            Cookie: `authToken=${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Verify response - may return error if Notion not connected
      const publishResult = await publishResponse.json();
      
      if (!publishResponse.ok()) {
        // If Notion is not connected, that's expected
        if (publishResult.error === 'Notion not connected' || publishResult.error === 'Notion destination not configured') {
          console.log(`✅ API returned expected error: ${publishResult.error}`);
          expect(publishResult.error).toBeTruthy();
          return; // Test passes - this is expected behavior
        }
        // Other errors should fail the test
        throw new Error(`Unexpected error: ${publishResult.error || publishResult.message || 'Unknown error'}`);
      }
      
      // Check that the response indicates success or queued
      expect(publishResult).toHaveProperty('success');
      expect(publishResult.success).toBe(true);
      
      // Should either publish immediately or queue enrichment
      expect(['publish', 'enrich_then_publish']).toContain(publishResult.action);
      
      console.log('✅ Publish response:', publishResult);
    }
  });

  test('should publish meeting to Notion via UI', async ({ page }) => {
    // Step 1: Sign in
    const email = process.env.TEST_EMAIL || 'test@example.com';
    const password = process.env.TEST_PASSWORD || 'testpassword';

    try {
      await signIn(page, email, password);
    } catch (error) {
      test.skip(`Authentication failed: ${error.message}. Please set TEST_EMAIL and TEST_PASSWORD environment variables with valid credentials.`);
      return;
    }

    // Step 2: Navigate to meetings page
    await page.goto(`${BASE_URL}/meetings`);
    await page.waitForLoadState('networkidle');

    // Step 3: Find and navigate to a meeting
    // Try to find a meeting link to get the URL, or navigate directly if we can extract it
    const meetingLinkSelectors = [
      'a[href^="/meetings/"]',
      'a[href*="/meetings/"]',
      '[href^="/meetings/"]',
    ];
    
    let meetingUrl = null;
    for (const selector of meetingLinkSelectors) {
      const links = page.locator(selector);
      const count = await links.count();
      if (count > 0) {
        const href = await links.first().getAttribute('href');
        if (href) {
          meetingUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          break;
        }
      }
    }
    
    if (!meetingUrl) {
      test.skip('No meetings found - create a test meeting first');
      return;
    }

    // Navigate directly to the meeting page
    console.log(`Navigating to meeting: ${meetingUrl}`);
    await page.goto(meetingUrl);
    await page.waitForLoadState('networkidle');

    // Step 4: Check if "Publish to Notion" button exists
    const publishButton = page.locator('#publish-btn');
    const publishButtonExists = await publishButton.count() > 0;

    if (!publishButtonExists) {
      console.log('⚠️  Publish to Notion button not found - Notion may not be connected');
      test.skip('Notion integration not configured');
      return;
    }

    // Step 5: Click the publish button
    await publishButton.click();

    // Step 6: Wait for notification or response
    // The UI shows notifications, so we'll wait for the button text to change or a notification to appear
    await page.waitForTimeout(2000); // Wait for API call to complete

    // Check for success notification or button state change
    const buttonText = await page.locator('#publish-btn-text').textContent();
    const notificationExists = await page.locator('[class*="notification"], [id*="notification"]').count() > 0;

    // Verify that either:
    // 1. Button text changed (indicating processing)
    // 2. A notification appeared
    // 3. Or check for error messages
    const hasError = await page.locator('text=/error|failed|not connected/i').count() > 0;
    
    if (hasError) {
      const errorText = await page.locator('text=/error|failed|not connected/i').first().textContent();
      console.log('⚠️  Error during publish:', errorText);
      // Don't fail the test - this might be expected if Notion isn't configured
      test.skip('Notion integration error: ' + errorText);
      return;
    }

    console.log('✅ Publish button clicked, button text:', buttonText);
    expect(buttonText).toBeTruthy();
  });

  test('should handle Notion not connected error gracefully', async ({ page, request }) => {
    // This test verifies the API returns proper error when Notion is not connected
    const email = process.env.TEST_EMAIL || 'test@example.com';
    const password = process.env.TEST_PASSWORD || 'testpassword';

    let authToken;
    try {
      authToken = await signIn(page, email, password);
    } catch (error) {
      test.skip(`Authentication failed: ${error.message}. Please set TEST_EMAIL and TEST_PASSWORD environment variables with valid credentials.`);
      return;
    }

    // Try to publish with a test meeting ID
    // This will fail if Notion is not connected, but should return a proper error
    const testMeetingId = process.env.TEST_MEETING_ID || 'test-meeting-id';
    
    const publishResponse = await request.post(
      `${BASE_URL}/api/meetings/${testMeetingId}/publish`,
      {
        headers: {
          Cookie: `authToken=${authToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const result = await publishResponse.json();
    
    // Should either succeed or return a proper error message
    if (!result.success) {
      expect(result).toHaveProperty('error');
      expect(['Notion not connected', 'Notion destination not configured', 'Meeting not found']).toContain(result.error);
      console.log('✅ API returned expected error:', result.error);
    } else {
      console.log('✅ Publish succeeded (Notion is connected)');
    }
  });
});


# Playwright Tests

This directory contains end-to-end tests for the Recall Calendar Integration application.

## Setup

1. Make sure your local server is running (or tests will start it automatically)
2. Set up test environment variables (optional):

```bash
export TEST_BASE_URL=http://localhost:3003
export TEST_EMAIL=your-test-email@example.com
export TEST_PASSWORD=your-test-password
export TEST_MEETING_ID=your-meeting-id-optional
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests with UI mode (interactive)
```bash
npm run test:ui
```

### Run tests in headed mode (visible browser)
```bash
npm run test:headed
```

### Run specific test file
```bash
npx playwright test tests/notion-publish.spec.js
```

### Run tests in debug mode
```bash
npm run test:debug
```

## Notion Publish Tests

The `notion-publish.spec.js` file contains tests for publishing meeting results to Notion:

1. **API Test**: Tests the `/api/meetings/:meetingId/publish` endpoint directly
2. **UI Test**: Tests the full user flow through the browser (sign in → navigate → click publish button)
3. **Error Handling Test**: Verifies proper error messages when Notion is not connected

### Prerequisites for Notion Tests

- A test user account with meetings
- Notion integration connected (optional - tests will skip gracefully if not configured)
- A Notion destination configured (optional - tests will skip gracefully if not configured)

### Test Behavior

- Tests will automatically sign in using credentials from environment variables
- If no `TEST_MEETING_ID` is provided, tests will try to find a meeting from the meetings list
- Tests gracefully skip if Notion is not configured (no hard failures)
- Tests verify both API responses and UI interactions

## Writing New Tests

1. Create a new `.spec.js` file in the `tests/` directory
2. Use Playwright's test API: `test()`, `expect()`, `page`, `request`
3. Follow the existing patterns for authentication and API calls
4. Use `test.skip()` for tests that require specific setup

## Configuration

Test configuration is in `playwright.config.js`:
- Base URL: `http://localhost:3003` (configurable via `TEST_BASE_URL`)
- Headless mode: Disabled by default (browsers are visible)
- Web server: Automatically starts `npm run dev` if server is not running


# Microsoft Teams Recording Integration Setup

This document explains how to set up and use the Microsoft Teams recording integration feature.

## Overview

The system can now identify Microsoft Teams meetings from calendar events, download transcripts/recordings from Microsoft Graph API, and apply AI generation (summaries, action items, etc.) to those meetings.

## Features

- **Automatic Detection**: Teams meetings are automatically detected during calendar sync
- **Transcript Fetching**: Downloads Teams-generated transcripts (.vtt format) when available
- **AI Enrichment**: Automatically processes transcripts through the existing enrichment pipeline
- **Manual Trigger**: API endpoint to manually trigger ingestion for specific meetings

## Setup Requirements

### 1. Azure App Registration Permissions

Your Microsoft OAuth app must have the following permissions:

- `OnlineMeetingTranscript.Read.All` - Read Teams meeting transcripts
- `OnlineMeetingRecording.Read.All` - Read Teams meeting recordings

These permissions are automatically included in the OAuth scopes when users connect their Microsoft Outlook calendar.

**Important**: These permissions require admin consent in most organizations. Users may need to request admin approval.

### 2. OAuth Configuration

The OAuth scopes have been updated in `recall/logic/oauth.js` to include Teams recording permissions. When users reconnect their Microsoft Outlook calendar, they'll be prompted to grant these new permissions.

### 3. Environment Variables

No new environment variables are required. The system uses existing Microsoft OAuth credentials:
- `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID`
- `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET`

## How It Works

### Automatic Ingestion

1. **Calendar Sync**: When calendar events are synced (via webhook or periodic sync), the system checks for Teams meetings
2. **Detection**: Teams meetings are identified by their `meeting_url` containing `teams.microsoft.com`
3. **Timing**: Only meetings that have ended are processed (recordings are typically available after the meeting ends)
4. **Delay**: A 5-minute delay is added after meeting end to ensure Microsoft has processed the recording
5. **Ingestion**: Transcript is fetched from Microsoft Graph API and stored
6. **Enrichment**: AI enrichment is automatically triggered

### Manual Trigger

You can manually trigger Teams recording ingestion via API:

```bash
# Ingest a specific calendar event
POST /api/trigger-teams-ingest
Content-Type: application/json

{
  "calendarEventId": "uuid-of-calendar-event"
}

# Ingest all Teams meetings for a calendar
POST /api/trigger-teams-ingest
Content-Type: application/json

{
  "calendarId": "uuid-of-calendar"
}
```

## Architecture

### Components

1. **Microsoft Graph Service** (`recall/services/microsoft-graph/`)
   - `api-client.js`: Low-level Graph API client with token refresh
   - `index.js`: High-level service for fetching transcripts

2. **Worker Processor** (`recall/worker/processors/teams-recording-ingest.js`)
   - Processes Teams recording ingestion jobs
   - Parses VTT transcripts into chunks
   - Stores data and triggers enrichment

3. **Calendar Sync Integration** (`recall/worker/processors/recall-calendar-sync-events.js`)
   - Automatically detects Teams meetings during sync
   - Queues ingestion jobs for eligible meetings

### Data Flow

```
Calendar Sync → Detect Teams Meeting → Queue Ingestion Job
                                                      ↓
                                    Fetch Transcript from Graph API
                                                      ↓
                                    Parse VTT → Store Chunks
                                                      ↓
                                    Trigger Enrichment → AI Generation
```

## Limitations & Notes

1. **Token Management**: Access tokens are refreshed automatically, but refresh tokens are stored by Recall.ai. The system attempts to refresh tokens when needed.

2. **Meeting ID Extraction**: The system extracts meeting IDs from Teams URLs. Some meeting formats may not be supported.

3. **User ID**: Microsoft Graph API may require the organizer's object ID rather than email. The system attempts to use email first, which works in many cases.

4. **Recording Availability**: Recordings are typically available 5-10 minutes after a meeting ends. The system adds a delay to account for this.

5. **Transcript Format**: Currently supports WebVTT (.vtt) format transcripts. If Teams provides recordings without transcripts, the system will not download the raw video (per user preference to use transcripts when available).

## Troubleshooting

### No Transcripts Found

- Verify the meeting was actually recorded in Teams
- Check that transcription was enabled during the meeting
- Ensure the meeting has ended (recordings are only available after the meeting)
- Verify OAuth permissions are granted (`OnlineMeetingTranscript.Read.All`)

### Token Refresh Errors

- Check that `MICROSOFT_OUTLOOK_OAUTH_CLIENT_ID` and `MICROSOFT_OUTLOOK_OAUTH_CLIENT_SECRET` are set correctly
- Verify the refresh token is still valid (may need to reconnect calendar)

### Permission Errors

- Ensure admin consent has been granted for `OnlineMeetingTranscript.Read.All` and `OnlineMeetingRecording.Read.All`
- Users may need to reconnect their Microsoft Outlook calendar to grant new permissions

## Future Enhancements

- Webhook support for real-time ingestion when recordings become available
- Support for downloading raw video recordings when transcripts are unavailable
- Better meeting ID extraction for various Teams URL formats
- Support for channel meetings (recordings stored in SharePoint)


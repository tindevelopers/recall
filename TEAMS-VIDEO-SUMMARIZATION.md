# Teams Video Recording and AI Summarization

## Overview

The system provides an **optional** way to pull Teams meeting videos and use AI to summarize meetings that have occurred. Teams recording ingestion is **manual-only** - you can trigger it on-demand when you need to pull and store a Teams meeting recording. This enhancement builds on the existing Teams recording integration to also fetch video recordings (not just transcripts) and ensure they're available for AI summarization.

## Features

### 1. **Manual Video Recording Fetching**
- On-demand Teams recording ingestion - pull recordings when you need them
- Fetches both:
  - **Transcripts** (if available) - Used for immediate AI summarization
  - **Video Recording URLs** - Stored for future use and video-based summarization

### 2. **Enhanced Teams Recording Ingestion**
The `teams-recording-ingest` processor now:
- Fetches transcript data from Microsoft Graph API
- Fetches video recording metadata and URLs
- Stores video URLs in the artifact's `sourceRecordingUrl` field
- Stores video metadata in the artifact's `rawPayload`
- Processes meetings even if only video (no transcript) is available

### 3. **Manual Trigger Options**
- Trigger ingestion for a specific Teams meeting
- Trigger ingestion for all Teams meetings in a calendar
- Full control over which meetings get processed

### 4. **AI Summarization**
- If transcript is available: Uses transcript chunks for immediate AI summarization
- If only video is available: Video URL is stored for future video transcription
- The enrichment pipeline (`meeting.enrich`) automatically processes transcripts to generate:
  - Meeting summaries
  - Action items
  - Follow-ups
  - Key insights and decisions

## How It Works

### Manual Processing Flow

1. **Manual Trigger** (`POST /api/trigger-teams-ingest`)
   - User triggers Teams recording ingestion for specific meetings
   - Can trigger for a single meeting or all Teams meetings in a calendar
   - Requires authentication and calendar ownership

2. **Teams Recording Ingestion** (`teams-recording-ingest`)
   - Fetches transcript from Microsoft Graph API (if available)
   - Fetches video recording metadata and URLs
   - Creates/updates `MeetingArtifact` with:
     - Transcript chunks (if transcript available)
     - Video recording URL (`sourceRecordingUrl`)
     - Video metadata in `rawPayload`
   - Queues `meeting.enrich` job for AI summarization

3. **AI Enrichment** (`meeting.enrich`)
   - Uses transcript chunks to generate summaries
   - Creates `MeetingSummary` with:
     - Summary text
     - Action items
     - Follow-ups
     - Key insights
   - Uses Notepad service (Recall.ai Notepad API or OpenAI fallback)

### Manual Triggering

Teams recording ingestion is **manual-only**. Use the API endpoint to pull recordings when needed:

**Trigger for a specific meeting:**
```bash
POST /api/trigger-teams-ingest
Headers: { Authorization: "Bearer <token>" }
Body: { calendarEventId: "..." }
```

**Trigger for all Teams meetings in a calendar:**
```bash
POST /api/trigger-teams-ingest
Headers: { Authorization: "Bearer <token>" }
Body: { calendarId: "..." }
```

**Response:**
```json
{
  "success": true,
  "message": "Queued Teams recording ingestion for event <id>",
  "calendarEventId": "..."
}
```

**Note:** You must be authenticated and own the calendar/event to trigger ingestion.

## Data Storage

### Meeting Artifact Fields

- `sourceRecordingUrl`: Direct URL to Teams video recording
- `rawPayload.data.teamsRecordingUrl`: Video recording URL (also stored here)
- `rawPayload.data.teamsRecordingMetadata`: Full recording metadata array
- `rawPayload.data.transcript`: Parsed transcript chunks (if available)

### Transcript Chunks

If transcript is available, chunks are stored in `MeetingTranscriptChunk` table with:
- `text`: Transcript text
- `speaker`: Speaker name
- `startTimeMs` / `endTimeMs`: Timestamps
- `sequence`: Order in transcript

## Requirements

### Microsoft Graph API Permissions

Your Microsoft OAuth app must have:
- `OnlineMeetingTranscript.Read.All` - Read Teams meeting transcripts
- `OnlineMeetingRecording.Read.All` - Read Teams meeting recordings

These permissions are included in the OAuth scopes when users connect their Microsoft Outlook calendar.

### Admin Consent

These permissions typically require admin consent in most organizations. Users may need to request admin approval.

## Future Enhancements

### Video Transcription
If only video is available (no transcript), the system currently stores the video URL. Future enhancements could:
- Transcribe video using speech-to-text services
- Use video transcription for AI summarization
- Support multiple transcription providers

### Video Playback
The stored video URLs can be used for:
- Direct video playback in the UI
- Video streaming through proxy endpoints
- Video archiving to cloud storage

## Troubleshooting

### No Transcript or Video Found

If neither transcript nor video is found:
- Check that the meeting has ended (recordings available after meeting ends)
- Verify Microsoft Graph API permissions are granted
- Check that the meeting organizer has recording enabled
- Wait a few minutes after meeting ends (Microsoft processes recordings)

### Video URL Expires

Teams recording URLs may expire after a certain period. The system stores the URL when available, but you may need to:
- Re-fetch the URL if it expires
- Use the Microsoft Graph API to get fresh URLs
- Archive videos to permanent storage

## Related Files

- `recall/worker/processors/teams-recording-ingest.js` - Main ingestion processor
- `recall/services/microsoft-graph/index.js` - Microsoft Graph API client
- `recall/worker/processors/meeting-enrich.js` - AI summarization processor
- `recall/routes/meetings/list.js` - Calendar sync with Teams detection
- `recall/routes/api/trigger-teams-ingest.js` - Manual trigger endpoint

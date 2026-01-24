# Verify shared-meeting chat access

1) Ensure you have a meeting shared **accepted** with the target user (via `meeting_shares` with `status = accepted`).

2) Obtain an auth token for that user (same auth used by the app), plus the `meetingArtifactId` (or `readableId`) of the shared meeting.

3) Run a chat query that should return meeting context:

```
curl -X POST "$API_BASE/api/chat/meetings" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "meetingArtifactId": "'"$MEETING_ID"'",
    "query": "What were the action items?"
  }'
```

Expected:
- If embeddings exist: HTTP 200 with an `answer` string.
- If embeddings are missing: HTTP 202 with `indexing: true` (and the embed job enqueued).
- If access is denied: HTTP 404.


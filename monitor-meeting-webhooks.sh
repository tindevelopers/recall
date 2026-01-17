#!/bin/bash
# Monitor webhooks for meeting recording and transcription data

echo "🔍 Monitoring Meeting Webhooks for Recording & Transcription"
echo "=============================================================="
echo ""
echo "This will monitor webhook logs for 15 minutes to check if payloads include:"
echo "  - Recording URLs (video_url, audio_url, recording_url)"
echo "  - Transcription data (transcript.segments, words, etc.)"
echo ""
echo "Press Ctrl+C to stop monitoring"
echo ""

# Monitor Railway logs for webhook activity
cd /Users/foo/projects/Recall.ai && railway logs --tail 0 -f 2>&1 | \
  grep --line-buffered -E "\[RECALL-NOTES\]|\[WEBHOOK\]" | \
  while IFS= read -r line; do
    echo "[$(date +'%H:%M:%S')] $line"
    
    # Highlight recording and transcription mentions
    if echo "$line" | grep -qi "recording\|video_url\|audio_url"; then
      echo "  ✅ RECORDING DATA DETECTED"
    fi
    
    if echo "$line" | grep -qi "transcript\|segments\|words"; then
      echo "  ✅ TRANSCRIPT DATA DETECTED"
    fi
  done

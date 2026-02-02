/**
 * Script to check for duplicate meeting artifacts that represent the same meeting
 * 
 * Run: node check-duplicate-meetings.js
 */

import dotenv from "dotenv";
dotenv.config();

import db from "./db.js";
import { connect as connectDb } from "./db.js";
import { Op } from "sequelize";

async function checkDuplicates() {
  await connectDb();
  console.log("Connected to database\n");

  // Get all artifacts
  const artifacts = await db.MeetingArtifact.findAll({
    order: [["createdAt", "DESC"]],
    include: [
      {
        model: db.CalendarEvent,
        required: false,
      },
    ],
  });

  console.log(`Found ${artifacts.length} total artifacts\n`);

  // Group artifacts by meeting identifier
  // Use: meeting URL thread_id, meeting ID, or start time + title
  const groups = new Map();

  function extractThreadId(meetingUrl) {
    if (!meetingUrl) return null;
    if (typeof meetingUrl === 'object' && meetingUrl.thread_id) {
      return meetingUrl.thread_id;
    }
    if (typeof meetingUrl === 'string') {
      const match = meetingUrl.match(/19:meeting_[^/@]+@thread\.v2/);
      return match ? match[0] : null;
    }
    return null;
  }

  function getMeetingKey(artifact) {
    const data = artifact.rawPayload?.data || {};
    const meetingUrl = data.meeting_url || artifact.meetingUrl;
    const threadId = extractThreadId(meetingUrl);
    
    // Try thread_id first (most reliable for Teams)
    if (threadId) {
      return `thread:${threadId}`;
    }
    
    // Try meeting ID
    const meetingId = artifact.meetingId || data.meeting_id || data.bot_metadata?.meeting_metadata?.meeting_id;
    if (meetingId) {
      return `meetingId:${meetingId}`;
    }
    
    // Fallback: start time + title (within 5 minutes)
    const startTime = data.start_time || artifact.CalendarEvent?.startTime;
    const title = data.title || artifact.CalendarEvent?.title || "Untitled";
    if (startTime) {
      const startDate = new Date(startTime);
      const startMinute = startDate.toISOString().substring(0, 16); // YYYY-MM-DDTHH:MM
      return `time+title:${startMinute}:${title}`;
    }
    
    // Last resort: use artifact ID (no grouping)
    return `unique:${artifact.id}`;
  }

  // Group artifacts
  for (const artifact of artifacts) {
    const key = getMeetingKey(artifact);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(artifact);
  }

  // Find groups with multiple artifacts
  const duplicates = [];
  for (const [key, groupArtifacts] of groups.entries()) {
    if (groupArtifacts.length > 1) {
      duplicates.push({ key, artifacts: groupArtifacts });
    }
  }

  console.log(`Found ${duplicates.length} groups with duplicate artifacts\n`);

  // Analyze duplicates
  for (const { key, artifacts: groupArtifacts } of duplicates) {
    console.log(`\n=== Duplicate Group: ${key} ===`);
    console.log(`  Count: ${groupArtifacts.length} artifacts`);
    
    // Sort by completeness (most complete first)
    const sorted = groupArtifacts.sort((a, b) => {
      const aData = a.rawPayload?.data || {};
      const bData = b.rawPayload?.data || {};
      
      const aHasTranscript = !!(aData.transcript && (Array.isArray(aData.transcript) ? aData.transcript.length > 0 : true));
      const bHasTranscript = !!(bData.transcript && (Array.isArray(bData.transcript) ? bData.transcript.length > 0 : true));
      
      const aHasRecording = !!(aData.video_url || aData.recording_url || aData.media_shortcuts?.video?.data?.download_url);
      const bHasRecording = !!(bData.video_url || bData.recording_url || bData.media_shortcuts?.video?.data?.download_url);
      
      const aScore = (aHasTranscript ? 2 : 0) + (aHasRecording ? 1 : 0);
      const bScore = (bHasTranscript ? 2 : 0) + (bHasRecording ? 1 : 0);
      
      return bScore - aScore;
    });
    
    for (let i = 0; i < sorted.length; i++) {
      const artifact = sorted[i];
      const data = artifact.rawPayload?.data || {};
      const hasTranscript = !!(data.transcript && (Array.isArray(data.transcript) ? data.transcript.length > 0 : true));
      const hasRecording = !!(data.video_url || data.recording_url || data.media_shortcuts?.video?.data?.download_url);
      
      console.log(`  ${i + 1}. Artifact ${artifact.id}`);
      console.log(`     recallBotId: ${artifact.recallBotId || 'null'}`);
      console.log(`     recallEventId: ${artifact.recallEventId || 'null'}`);
      console.log(`     calendarEventId: ${artifact.calendarEventId || 'null'}`);
      console.log(`     createdAt: ${artifact.createdAt}`);
      console.log(`     hasTranscript: ${hasTranscript}`);
      console.log(`     hasRecording: ${hasRecording}`);
      console.log(`     title: ${data.title || artifact.CalendarEvent?.title || 'Untitled'}`);
      console.log(`     startTime: ${data.start_time || artifact.CalendarEvent?.startTime || 'null'}`);
    }
  }

  // Check for the specific "testing Outlook" meeting
  const testingOutlook = artifacts.filter(a => {
    const data = a.rawPayload?.data || {};
    const title = data.title || a.CalendarEvent?.title || '';
    return title.toLowerCase().includes('testing outlook');
  });
  
  if (testingOutlook.length > 0) {
    console.log(`\n\n=== "testing Outlook" Meeting Analysis ===`);
    console.log(`Found ${testingOutlook.length} artifacts for "testing Outlook"`);
    
    const key = getMeetingKey(testingOutlook[0]);
    const group = groups.get(key);
    if (group && group.length > 1) {
      console.log(`\nThese artifacts are grouped under key: ${key}`);
      console.log(`Group size: ${group.length}`);
      
      for (const artifact of group) {
        const data = artifact.rawPayload?.data || {};
        const hasTranscript = !!(data.transcript && (Array.isArray(data.transcript) ? data.transcript.length > 0 : true));
        const hasRecording = !!(data.video_url || data.recording_url || data.media_shortcuts?.video?.data?.download_url);
        const duration = data.recordings?.[0]?.duration_seconds || 
                        data.recordings?.[0]?.duration ||
                        data.recordings?.[0]?.length_seconds ||
                        null;
        
        console.log(`\n  Artifact ${artifact.id}:`);
        console.log(`    recallBotId: ${artifact.recallBotId}`);
        console.log(`    recallEventId: ${artifact.recallEventId}`);
        console.log(`    hasTranscript: ${hasTranscript}`);
        console.log(`    hasRecording: ${hasRecording}`);
        console.log(`    duration: ${duration ? `${Math.round(duration / 60)} min` : 'null'}`);
        console.log(`    createdAt: ${artifact.createdAt}`);
      }
    }
  }

  process.exit(0);
}

checkDuplicates().catch(console.error);

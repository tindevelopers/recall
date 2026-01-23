import db, { connect as connectDb } from "../db.js";
import Recall from "../services/recall/index.js";
import { fetchTeamsRecordingMetadata } from "../services/microsoft-graph/index.js";
import { getClient } from "../services/recall/api-client.js";

const resolveSourceUrl = (artifact) =>
  artifact.archivedRecordingUrl ||
  artifact.sourceRecordingUrl ||
  artifact.rawPayload?.data?.video_url ||
  artifact.rawPayload?.data?.recording_url ||
  artifact.rawPayload?.data?.media_shortcuts?.video_mixed?.data?.download_url ||
  artifact.rawPayload?.data?.media_shortcuts?.audio_mixed?.data?.download_url ||
  artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
  artifact.rawPayload?.media_shortcuts?.video?.data?.download_url ||
  artifact.rawPayload?.recording_url ||
  null;

async function testGetRecording() {
  try {
    await connectDb();
    Recall.initialize();
    
    const meetingId = "54d68780-2141-43f5-b1ce-1a4b18f222e3"; // PetJet meeting
    
    console.log(`\n🧪 Testing get-recording endpoint logic for meeting: ${meetingId}\n`);
    
    // Find the meeting artifact
    const artifact = await db.MeetingArtifact.findOne({
      where: { id: meetingId },
      include: [{ model: db.CalendarEvent, include: [{ model: db.Calendar }] }],
    });

    if (!artifact) {
      console.log("❌ Meeting artifact not found");
      process.exit(1);
    }

    console.log(`✅ Found artifact: ${artifact.id}`);
    console.log(`   Title: ${artifact.CalendarEvent?.title || "Unknown"}`);
    console.log(`   Bot ID: ${artifact.recallBotId || "None"}`);
    console.log(`   Calendar Event ID: ${artifact.CalendarEvent?.id || "None"}`);
    console.log(`   Recall Event ID: ${artifact.CalendarEvent?.recallId || "None"}`);

    // Check cached URLs
    const cachedVideoUrl =
      artifact.rawPayload?.data?.video_url ||
      artifact.rawPayload?.data?.recording_url ||
      artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url;
    const cachedAudioUrl =
      artifact.rawPayload?.data?.audio_url ||
      artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url;

    console.log(`\n📦 Cached URLs:`);
    console.log(`   Video: ${cachedVideoUrl || "None"}`);
    console.log(`   Audio: ${cachedAudioUrl || "None"}`);

    if (cachedVideoUrl || cachedAudioUrl) {
      console.log(`\n✅ Found cached URLs - would return immediately`);
      process.exit(0);
    }

    // Try fetching bot directly (v1 preferred) and extract mixed shortcuts
    if (artifact.recallBotId) {
      console.log(`\n📡 Step 1: Trying to fetch bot directly (v1 preferred)...`);
      try {
        const botData = await Recall.getBot(artifact.recallBotId);
        console.log(`   ✅ Bot found!`);
        console.log(`      Status: ${botData.status?.code || botData.status || "Unknown"}`);
        console.log(`      Recordings: ${botData.recordings?.length || 0}`);

        const urls = Recall.getRecordingUrlsFromBot(botData);
        console.log(`      Video URL: ${urls.videoUrl || "None"}`);
        console.log(`      Audio URL: ${urls.audioUrl || "None"}`);

        if (urls.videoUrl || urls.audioUrl) {
          console.log(`\n✅ Found recording URLs from bot!`);
          await artifact.update({
            sourceRecordingUrl: urls.videoUrl || urls.audioUrl,
            rawPayload: {
              ...artifact.rawPayload,
              data: {
                ...artifact.rawPayload?.data,
                video_url: urls.videoUrl,
                audio_url: urls.audioUrl,
                recording_url: urls.videoUrl || urls.audioUrl,
                recordings: botData.recordings,
                media_shortcuts: botData.recordings?.[0]?.media_shortcuts || botData.media_shortcuts,
              },
            },
          });
          console.log(`   ✅ Updated artifact with recording URLs!`);
          console.log(`   Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
          process.exit(0);
        }
      } catch (botError) {
        console.log(`   ❌ Bot fetch failed: ${botError.message}`);
      }

      // Try listRecordingsV1 for historical media
      console.log(`\n📡 Step 2: Trying listRecordingsV1 (status=done)...`);
      try {
        const recordingsResp = await Recall.listRecordingsV1({
          botId: artifact.recallBotId,
          statusCode: "done",
        });
        const recordings =
          recordingsResp?.results ||
          recordingsResp?.recordings ||
          (Array.isArray(recordingsResp) ? recordingsResp : []);
        console.log(`   Recordings returned: ${recordings.length}`);
        const urls = Recall.getRecordingUrlsFromBot({ recordings });
        console.log(`   Video URL: ${urls.videoUrl || "None"}`);
        console.log(`   Audio URL: ${urls.audioUrl || "None"}`);
        if (urls.videoUrl || urls.audioUrl) {
          await artifact.update({
            sourceRecordingUrl: urls.videoUrl || urls.audioUrl,
            rawPayload: {
              ...artifact.rawPayload,
              data: {
                ...artifact.rawPayload?.data,
                video_url: urls.videoUrl,
                audio_url: urls.audioUrl,
                recording_url: urls.videoUrl || urls.audioUrl,
                recordings,
                media_shortcuts: recordings[0]?.media_shortcuts,
              },
            },
          });
          console.log(`\n✅ Updated artifact with recording URLs from listRecordingsV1!`);
          console.log(`   Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
          process.exit(0);
        }
      } catch (listErr) {
        console.log(`   ❌ listRecordingsV1 failed: ${listErr.message}`);
      }

      // Try calendar event bots array via v2, then fetch each bot via v1/v2
      console.log(`\n📡 Step 3: Trying calendar event's bots array...`);
      try {
        const calendarEvent = artifact.CalendarEvent;
        if (calendarEvent && calendarEvent.recallId) {
          console.log(`   Fetching calendar event ${calendarEvent.recallId}...`);
          const recallClient = getClient();
          const recallEvent = await recallClient.request({
            path: `/api/v2/calendar-events/${calendarEvent.recallId}/`,
            method: "GET",
          });

          console.log(`   ✅ Calendar event fetched!`);
          console.log(`      Bots count: ${recallEvent?.bots?.length || 0}`);

          if (recallEvent?.bots && Array.isArray(recallEvent.bots) && recallEvent.bots.length > 0) {
            console.log(`\n   Bot structure sample:`, JSON.stringify(recallEvent.bots[0], null, 2).substring(0, 1000));

            for (const botRef of recallEvent.bots) {
              const botId = botRef.bot_id || botRef.id;
              console.log(`\n   Checking bot reference: ${botId || "None"}`);
              if (!botId) continue;

              // Try v1 bot fetch
              try {
                const fullBot = await Recall.getBot(botId);
                console.log(`      ✅ Bot fetched! status=${fullBot.status?.code || fullBot.status || "Unknown"}, recordings=${fullBot.recordings?.length || 0}`);
                const urls = Recall.getRecordingUrlsFromBot(fullBot);
                console.log(`      Video URL: ${urls.videoUrl || "None"}`);
                console.log(`      Audio URL: ${urls.audioUrl || "None"}`);
                if (urls.videoUrl || urls.audioUrl) {
                  await artifact.update({
                    sourceRecordingUrl: urls.videoUrl || urls.audioUrl,
                    rawPayload: {
                      ...artifact.rawPayload,
                      data: {
                        ...artifact.rawPayload?.data,
                        video_url: urls.videoUrl,
                        audio_url: urls.audioUrl,
                        recording_url: urls.videoUrl || urls.audioUrl,
                        recordings: fullBot.recordings,
                        media_shortcuts: fullBot.recordings?.[0]?.media_shortcuts || fullBot.media_shortcuts,
                      },
                    },
                  });
                  console.log(`\n✅ Updated artifact with recording URLs from calendar bot fetch!`);
                  console.log(`   Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
                  process.exit(0);
                }
              } catch (botError) {
                console.log(`      ❌ Bot fetch failed: ${botError.message}`);
              }

              // Try list recordings for that bot id
              try {
                const recResp = await Recall.listRecordingsV1({
                  botId,
                  statusCode: "done",
                });
                const recs =
                  recResp?.results ||
                  recResp?.recordings ||
                  (Array.isArray(recResp) ? recResp : []);
                console.log(`      listRecordings returned: ${recs.length}`);
                const urls = Recall.getRecordingUrlsFromBot({ recordings: recs });
                console.log(`      Video URL (list): ${urls.videoUrl || "None"}`);
                console.log(`      Audio URL (list): ${urls.audioUrl || "None"}`);
                if (urls.videoUrl || urls.audioUrl) {
                  await artifact.update({
                    sourceRecordingUrl: urls.videoUrl || urls.audioUrl,
                    rawPayload: {
                      ...artifact.rawPayload,
                      data: {
                        ...artifact.rawPayload?.data,
                        video_url: urls.videoUrl,
                        audio_url: urls.audioUrl,
                        recording_url: urls.videoUrl || urls.audioUrl,
                        recordings: recs,
                        media_shortcuts: recs[0]?.media_shortcuts,
                      },
                    },
                  });
                  console.log(`\n✅ Updated artifact with recording URLs from listRecordings (calendar bot)!`);
                  console.log(`   Meeting URL: http://localhost:3003/meetings/${artifact.id}`);
                  process.exit(0);
                }
              } catch (recErr) {
                console.log(`      ❌ listRecordings for bot ${botId} failed: ${recErr.message}`);
              }
            }
          } else {
            console.log(`   ⚠️  No bots found in calendar event`);
          }
        } else {
          console.log(`   ⚠️  No recallId on calendar event`);
        }
      } catch (calendarError) {
        console.log(`   ❌ Calendar event fetch failed: ${calendarError.message}`);
      }
    } else {
      console.log(`\n⚠️  No bot ID found on artifact`);
    }

    console.log(`\n❌ No recording URLs found`);
    process.exit(1);
  } catch (error) {
    console.error("❌ Error:", error);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

testGetRecording();


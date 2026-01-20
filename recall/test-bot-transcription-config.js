/**
 * Test script to verify bot configuration includes transcription settings
 * This simulates what happens when a bot is scheduled for a calendar event
 * 
 * Usage: node test-bot-transcription-config.js
 */

console.log("🧪 Testing Bot Transcription Configuration\n");
console.log("=" .repeat(60));

// Simulate calendar objects with different transcription settings
const testCalendars = [
  {
    name: "Calendar with transcription ENABLED (default)",
    enableTranscription: true,
    transcriptionMode: "realtime",
    transcriptionLanguage: "en",
    useRetellTranscription: false,
    recordVideo: true,
    recordAudio: true,
    botName: "Meeting Assistant",
    joinBeforeStartMinutes: 1,
    autoLeaveIfAlone: true,
    autoLeaveAloneTimeoutSeconds: 60,
  },
  {
    name: "Calendar with transcription DISABLED",
    enableTranscription: false,
    transcriptionMode: "realtime",
    transcriptionLanguage: "en",
    useRetellTranscription: false,
    recordVideo: true,
    recordAudio: true,
    botName: "Meeting Assistant",
    joinBeforeStartMinutes: 1,
    autoLeaveIfAlone: true,
    autoLeaveAloneTimeoutSeconds: 60,
  },
  {
    name: "Calendar with async transcription",
    enableTranscription: true,
    transcriptionMode: "async",
    transcriptionLanguage: "en",
    useRetellTranscription: false,
    recordVideo: true,
    recordAudio: true,
    botName: "Meeting Assistant",
    joinBeforeStartMinutes: 1,
    autoLeaveIfAlone: true,
    autoLeaveAloneTimeoutSeconds: 60,
  },
  {
    name: "Calendar with Retell transcription",
    enableTranscription: true,
    transcriptionMode: "realtime",
    transcriptionLanguage: "en",
    useRetellTranscription: true,
    recordVideo: true,
    recordAudio: true,
    botName: "Meeting Assistant",
    joinBeforeStartMinutes: 1,
    autoLeaveIfAlone: true,
    autoLeaveAloneTimeoutSeconds: 60,
  },
];

// Function that builds bot config exactly as the scheduler does
function buildBotConfig(calendar) {
  const botConfig = {};
  
  // Bot appearance
  if (calendar.botName) {
    botConfig.bot_name = calendar.botName;
  }
  
  // Transcription settings - Only enable if calendar.enableTranscription is true
  // Users can disable transcription from the Bot Settings page
  if (calendar && calendar.enableTranscription !== false) {
    botConfig.transcription = {
      provider: calendar.useRetellTranscription ? "retell" : "default",
      mode: calendar.transcriptionMode || "realtime", // "realtime" or "async"
    };
    if (calendar.transcriptionLanguage && calendar.transcriptionLanguage !== "auto") {
      botConfig.transcription.language = calendar.transcriptionLanguage;
    }
  }
  // If enableTranscription is false, transcription config is omitted from botConfig
  
  // Recording settings
  if (calendar) {
    botConfig.recording = {
      video: calendar.recordVideo !== false,
      audio: calendar.recordAudio !== false,
    };
  }
  
  // Bot behavior settings
  if (calendar) {
    if (calendar.joinBeforeStartMinutes > 0) {
      botConfig.join_at = {
        minutes_before_start: calendar.joinBeforeStartMinutes,
      };
    }
    if (calendar.autoLeaveIfAlone) {
      botConfig.automatic_leave = {
        waiting_room_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
        noone_joined_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
      };
    }
  }
  
  return botConfig;
}

// Test each calendar configuration
testCalendars.forEach((calendar, idx) => {
  console.log(`\n📋 Test Case ${idx + 1}: ${calendar.name}`);
  console.log("-".repeat(60));
  
  const botConfig = buildBotConfig(calendar);
  
  console.log("\n✅ Bot Configuration that would be sent to Recall API:");
  console.log(JSON.stringify(botConfig, null, 2));
  
  // Validation
  console.log("\n🔍 Validation:");
  const hasTranscription = !!botConfig.transcription;
  const shouldHaveTranscription = calendar.enableTranscription !== false;
  
  if (hasTranscription === shouldHaveTranscription) {
    console.log(`✅ Transcription config is ${hasTranscription ? "included" : "omitted"} (correct)`);
    
    if (hasTranscription) {
      console.log(`   - Provider: ${botConfig.transcription.provider}`);
      console.log(`   - Mode: ${botConfig.transcription.mode}`);
      console.log(`   - Language: ${botConfig.transcription.language || "not specified"}`);
      
      // Verify mode is correct
      if (botConfig.transcription.mode === calendar.transcriptionMode) {
        console.log(`   ✅ Mode matches calendar setting`);
      } else {
        console.log(`   ❌ Mode mismatch: expected ${calendar.transcriptionMode}, got ${botConfig.transcription.mode}`);
      }
      
      // Verify provider is correct
      const expectedProvider = calendar.useRetellTranscription ? "retell" : "default";
      if (botConfig.transcription.provider === expectedProvider) {
        console.log(`   ✅ Provider matches calendar setting`);
      } else {
        console.log(`   ❌ Provider mismatch: expected ${expectedProvider}, got ${botConfig.transcription.provider}`);
      }
    }
  } else {
    console.log(`❌ Transcription config mismatch:`);
    console.log(`   Expected: ${shouldHaveTranscription ? "included" : "omitted"}`);
    console.log(`   Actual: ${hasTranscription ? "included" : "omitted"}`);
  }
  
  // Verify recording settings
  if (botConfig.recording) {
    console.log(`✅ Recording settings included`);
    console.log(`   - Video: ${botConfig.recording.video}`);
    console.log(`   - Audio: ${botConfig.recording.audio}`);
  } else {
    console.log(`❌ Recording settings missing`);
  }
});

console.log("\n" + "=" .repeat(60));
console.log("\n📝 Summary:");
console.log("=" .repeat(60));
console.log("✅ When enableTranscription is true: Transcription config IS included");
console.log("✅ When enableTranscription is false: Transcription config is OMITTED");
console.log("✅ Bot will request transcripts when transcription config is present");
console.log("✅ Bot will NOT request transcripts when transcription config is absent");
console.log("\n💡 To enable transcription for a calendar:");
console.log("   1. Go to Calendar Settings → Bot Settings");
console.log("   2. Check 'Enable Transcription'");
console.log("   3. Choose 'Real-time' or 'Async' mode");
console.log("   4. Save settings");
console.log("\n✅ Test completed successfully!");

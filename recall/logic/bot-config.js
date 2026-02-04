/**
 * Build Recall.ai bot_config for adding a bot to a calendar event.
 *
 * Important details for transcription:
 * - Recall expects `recording_config.transcript.provider` to be an object keyed by provider name
 *   (e.g. { recallai_streaming: { mode: "prioritize_low_latency" } })
 * - For real-time transcript delivery, include `recording_config.realtime_endpoints` with events
 *   like `transcript.partial_data` / `transcript.data`.
 *
 * @param {Object} options
 * @param {Object} options.calendar - Calendar settings (provides defaults)
 * @param {Object} options.event - Optional CalendarEvent with per-meeting overrides
 * @param {string} options.publicUrl - Public URL for webhook endpoints
 */
export function buildBotConfig({ calendar, event, publicUrl }) {
  const botConfig = {};

  // Bot appearance
  if (calendar) {
    if (calendar.botName) {
      botConfig.bot_name = calendar.botName;
    }
    if (calendar.botAvatarUrl) {
      botConfig.bot_image = calendar.botAvatarUrl;
    }
  }

  // Recording config - specify output media types
  // Recall.ai requires explicit media type specifications, not just video/audio booleans
  botConfig.recording_config = {};

  if (calendar) {
    // Request video recording in MP4 format (mixed view of all participants)
    if (calendar.recordVideo !== false) {
      botConfig.recording_config.video_mixed_mp4 = {};
    }
    
    // Request audio recording in MP3 format (mixed audio of all participants)
    if (calendar.recordAudio !== false) {
      botConfig.recording_config.audio_mixed_mp3 = {};
    }
  } else {
    // Default: request both video and audio if no calendar settings
    botConfig.recording_config.video_mixed_mp4 = {};
    botConfig.recording_config.audio_mixed_mp3 = {};
  }

  // Transcription config
  if (calendar && calendar.enableTranscription !== false) {
    const languageCode =
      calendar.transcriptionLanguage && calendar.transcriptionLanguage !== "auto"
        ? calendar.transcriptionLanguage
        : null;

    // Determine transcription mode: event override takes precedence over calendar default
    // event.transcriptionMode can be 'realtime', 'async', or null (use calendar default)
    const effectiveTranscriptionMode = event?.transcriptionMode || calendar.transcriptionMode || "realtime";

    // Map our "realtime/async" UI to Recall provider config.
    // For real-time visibility in the UI/logs, prefer low-latency when language is compatible.
    const wantsRealtime = effectiveTranscriptionMode === "realtime";
    const providerMode =
      wantsRealtime && (!languageCode || languageCode === "en")
        ? "prioritize_low_latency"
        : "prioritize_accuracy";

    // Use recallai_streaming as the provider (retell might not be available in all regions)
    const provider = {
      recallai_streaming: {
        mode: providerMode,
        ...(languageCode ? { language_code: languageCode } : {}),
      },
    };

    botConfig.recording_config.transcript = {
      provider,
    };

    // Request real-time delivery of transcript events to our webhook.
    // Without this, you typically won't receive streaming transcript events.
    if (wantsRealtime && publicUrl) {
      botConfig.recording_config.realtime_endpoints = [
        {
          type: "webhook",
          url: `${publicUrl}/webhooks/recall-notes`,
          events: [
            "transcript.partial_data",
            "transcript.data",
          ],
        },
      ];
    }
  }

  // Status callback URL - receives bot lifecycle events (recording.done, bot.status_change, etc.)
  // This is REQUIRED for receiving notifications when recording is complete
  if (publicUrl) {
    botConfig.status_callback_url = `${publicUrl}/webhooks/recall-notes`;
  }

  // Bot behavior settings
  if (calendar) {
    // Note: join_at should be calculated based on event start time, not set here
    // The join_at is calculated when scheduling the bot, not in the bot config
    // We'll handle this in the bot scheduling processor
    if (calendar.autoLeaveIfAlone) {
      botConfig.automatic_leave = {
        waiting_room_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
        noone_joined_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
        everyone_left_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
      };
    }
  }

  // Bot detection: tell the difference between real participants and other notetakers/bots.
  // If another notetaker (e.g. Otter, Fireflies, human-named "Notetaker") is detected and only
  // bots remain in the meeting, our bot will disconnect and leave to avoid duplicate notes.
  botConfig.bot_detection = {
    // Detect other notetakers/bots by participant display names
    using_participant_names: {
      keywords: [
        // Generic bot indicators
        "notetaker",
        "note taker",
        "recorder",
        "assistant",
        "bot",
        "ai ",
        " ai",
        // Common AI meeting bot vendors
        "otter",
        "otter.ai",
        "fireflies",
        "fireflies.ai",
        "read.ai",
        "read ai",
        "fathom",
        "grain",
        "gong",
        "chorus",
        "avoma",
        "meetgeek",
        "krisp",
        "sembly",
        "tactiq",
        "tl;dv",
        "tldv",
        "vowel",
        "airgram",
        "jamie",
        "supernormal",
        "fellow",
        "nylas",
        "circleback",
        "bluedot",
        "meetrecord",
        "claap",
        "rewatch",
        "loom",
        "recall",
      ],
      // Start detecting after 5 minutes to allow humans time to join
      activate_after: 300,
      // Leave 10 seconds after detecting only bots remain
      timeout: 10,
    },
    // Also detect by behavior: participants who never speak or share screen are likely bots
    using_participant_events: {
      types: ["active_speaker", "screen_share"],
      // Start detecting after 5 minutes
      activate_after: 300,
      // Leave 30 seconds after detecting no human activity
      timeout: 30,
    },
  };
  // Result: bot leaves when it detects only other notetakers/bots (no real participants).

  return botConfig;
}

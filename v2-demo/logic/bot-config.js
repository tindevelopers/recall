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

  // Recording config
  botConfig.recording_config = {};

  if (calendar) {
    botConfig.recording_config.video = calendar.recordVideo !== false;
    botConfig.recording_config.audio = calendar.recordAudio !== false;
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

  // Bot behavior settings
  if (calendar) {
    // Note: join_at should be calculated based on event start time, not set here
    // The join_at is calculated when scheduling the bot, not in the bot config
    // We'll handle this in the bot scheduling processor
    if (calendar.autoLeaveIfAlone) {
      botConfig.automatic_leave = {
        waiting_room_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
        noone_joined_timeout: calendar.autoLeaveAloneTimeoutSeconds || 60,
      };
    }
  }

  return botConfig;
}

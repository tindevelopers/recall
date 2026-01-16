/**
 * Build Recall.ai bot_config for adding a bot to a calendar event.
 *
 * Important details for transcription:
 * - Recall expects `recording_config.transcript.provider` to be an object keyed by provider name
 *   (e.g. { recallai_streaming: { mode: "prioritize_low_latency" } })
 * - For real-time transcript delivery, include `recording_config.realtime_endpoints` with events
 *   like `transcript.partial_data` / `transcript.data`.
 */
export function buildBotConfig({ calendar, publicUrl }) {
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

    // Map our "realtime/async" UI to Recall provider config.
    // For real-time visibility in the UI/logs, prefer low-latency when language is compatible.
    const wantsRealtime = calendar.transcriptionMode === "realtime";
    const providerMode =
      wantsRealtime && (!languageCode || languageCode === "en")
        ? "prioritize_low_latency"
        : "prioritize_accuracy";

    const provider = calendar.useRetellTranscription
      ? { retell: {} }
      : {
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
            "transcript.done",
            "transcript.failed",
            "recording.done",
            "bot.status_change",
          ],
        },
      ];
    }
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


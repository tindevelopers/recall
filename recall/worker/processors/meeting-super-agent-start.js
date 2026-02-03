import db from "../../db.js";
import AssemblyAI from "../../services/assemblyai/index.js";

function resolvePublicUrl() {
  let publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl && process.env.RAILWAY_PUBLIC_DOMAIN) {
    publicUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  if (!publicUrl && process.env.RAILWAY_STATIC_URL) {
    publicUrl = process.env.RAILWAY_STATIC_URL;
  }
  return publicUrl ? publicUrl.replace(/\/$/, "") : null;
}

function resolveRecordingUrl(artifact) {
  return (
    artifact.archivedRecordingUrl ||
    artifact.rawPayload?.data?.video_url ||
    artifact.rawPayload?.data?.recording_url ||
    artifact.rawPayload?.data?.media_shortcuts?.video_mixed?.data?.download_url ||
    artifact.rawPayload?.data?.media_shortcuts?.video?.data?.download_url ||
    artifact.rawPayload?.data?.media_shortcuts?.audio_mixed?.data?.download_url ||
    artifact.rawPayload?.data?.media_shortcuts?.audio?.data?.download_url ||
    artifact.rawPayload?.data?.audio_url ||
    artifact.sourceRecordingUrl ||
    artifact.rawPayload?.data?.teamsRecordingUrl ||
    artifact.rawPayload?.data?.teams_video_url ||
    artifact.rawPayload?.teamsRecordingUrl ||
    artifact.rawPayload?.data?.sharePointRecordingUrl ||
    null
  );
}

function buildTranscriptionConfig(requestedFeatures = {}, webhookUrl) {
  const config = {
    auto_chapters: true,
    speaker_labels: true,
    iab_categories: !!requestedFeatures.topicDetection,
    content_safety: !!requestedFeatures.contentModeration,
    redact_pii: !!requestedFeatures.piiRedaction,
    filter_profanity: !!requestedFeatures.profanityFiltering,
    sentiment_analysis: !!requestedFeatures.sentimentAnalysis,
  };

  if (webhookUrl) {
    config.webhook_url = webhookUrl;
    if (process.env.ASSEMBLYAI_WEBHOOK_SECRET) {
      config.webhook_auth_header_name =
        process.env.ASSEMBLYAI_WEBHOOK_HEADER_NAME || "x-assemblyai-webhook-secret";
      config.webhook_auth_header_value = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
    }
  }

  if (Array.isArray(requestedFeatures.translateTo) && requestedFeatures.translateTo.length > 0) {
    config.speech_understanding = {
      request: {
        translation: {
          target_languages: requestedFeatures.translateTo,
          formal: true,
          match_original_utterance: true,
        },
      },
    };
  }

  return config;
}

export default async (job) => {
  const { analysisId, meetingArtifactId, requestedFeatures } = job.data;

  const analysis = await db.MeetingSuperAgentAnalysis.findByPk(analysisId);
  if (!analysis) {
    console.warn(`[SuperAgent] Analysis ${analysisId} not found`);
    return;
  }

  if (analysis.status === "completed") {
    console.log(`[SuperAgent] Analysis ${analysisId} already completed`);
    return;
  }

  const artifact = await db.MeetingArtifact.findByPk(meetingArtifactId, {
    include: [
      {
        model: db.CalendarEvent,
        include: [{ model: db.Calendar }],
      },
    ],
  });

  if (!artifact) {
    await analysis.update({
      status: "error",
      errorMessage: "Meeting artifact not found",
    });
    return;
  }

  const recordingUrl = resolveRecordingUrl(artifact);
  if (!recordingUrl) {
    await analysis.update({
      status: "error",
      errorMessage: "No recording URL available for analysis",
    });
    return;
  }

  const publicUrl = resolvePublicUrl();
  if (!publicUrl) {
    await analysis.update({
      status: "error",
      errorMessage: "PUBLIC_URL not configured for AssemblyAI webhooks",
    });
    return;
  }

  const webhookUrl = `${publicUrl}/webhooks/assemblyai`;
  const features = requestedFeatures || analysis.requestedFeatures || {};
  const config = buildTranscriptionConfig(features, webhookUrl);

  try {
    const { transcript, requestBody } = await AssemblyAI.submitTranscript({
      audioUrl: recordingUrl,
      requestBody: config,
      allowUploadFallback: true,
    });

    await analysis.update({
      status: "processing",
      assemblyTranscriptId: transcript.id,
      assemblyRequest: requestBody,
      errorMessage: null,
    });

    console.log(
      `[SuperAgent] Submitted AssemblyAI transcript ${transcript.id} for analysis ${analysis.id}`
    );
  } catch (error) {
    console.error(`[SuperAgent] Failed to submit transcript:`, error);
    await analysis.update({
      status: "error",
      errorMessage: error?.message || "Failed to submit transcription",
    });
  }
};

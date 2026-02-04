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

  // #region agent log - H12: Debug Super Agent processor start
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meeting-super-agent-start.js:processor',message:'super_agent_processor_start',data:{analysisId,meetingArtifactId,requestedFeatures},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H12'})}).catch(()=>{});
  // #endregion

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
    // #region agent log - H12b: Debug artifact not found
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meeting-super-agent-start.js:processor',message:'super_agent_artifact_not_found',data:{analysisId,meetingArtifactId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H12b'})}).catch(()=>{});
    // #endregion
    return;
  }

  const recordingUrl = resolveRecordingUrl(artifact);
  if (!recordingUrl) {
    await analysis.update({
      status: "error",
      errorMessage: "No recording URL available for analysis",
    });
    // #region agent log - H12c: Debug no recording URL
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meeting-super-agent-start.js:processor',message:'super_agent_no_recording_url',data:{analysisId,artifactId:artifact.id,archivedRecordingUrl:artifact.archivedRecordingUrl?.substring(0,50),sourceRecordingUrl:artifact.sourceRecordingUrl?.substring(0,50),rawPayloadKeys:Object.keys(artifact.rawPayload||{})},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H12c'})}).catch(()=>{});
    // #endregion
    return;
  }

  const publicUrl = resolvePublicUrl();
  if (!publicUrl) {
    await analysis.update({
      status: "error",
      errorMessage: "PUBLIC_URL not configured for AssemblyAI webhooks",
    });
    // #region agent log - H12d: Debug no public URL
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meeting-super-agent-start.js:processor',message:'super_agent_no_public_url',data:{analysisId,PUBLIC_URL:process.env.PUBLIC_URL,RAILWAY_PUBLIC_DOMAIN:process.env.RAILWAY_PUBLIC_DOMAIN,RAILWAY_STATIC_URL:process.env.RAILWAY_STATIC_URL},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H12d'})}).catch(()=>{});
    // #endregion
    return;
  }

  const webhookUrl = `${publicUrl}/webhooks/assemblyai`;
  const features = requestedFeatures || analysis.requestedFeatures || {};
  const config = buildTranscriptionConfig(features, webhookUrl);

  // #region agent log - H12e: Debug before AssemblyAI submission
  fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meeting-super-agent-start.js:processor',message:'super_agent_before_assemblyai_submit',data:{analysisId,recordingUrlPrefix:recordingUrl?.substring(0,80),webhookUrl,features,configKeys:Object.keys(config||{}),hasAssemblyAIKey:!!process.env.ASSEMBLYAI_API_KEY},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H12e'})}).catch(()=>{});
  // #endregion

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

    // #region agent log - H12f: Debug AssemblyAI submission success
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meeting-super-agent-start.js:processor',message:'super_agent_assemblyai_submitted',data:{analysisId,transcriptId:transcript.id,status:'processing'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H12f'})}).catch(()=>{});
    // #endregion

    console.log(
      `[SuperAgent] Submitted AssemblyAI transcript ${transcript.id} for analysis ${analysis.id}`
    );
  } catch (error) {
    console.error(`[SuperAgent] Failed to submit transcript:`, error);
    // #region agent log - H12g: Debug AssemblyAI submission error
    fetch('http://127.0.0.1:7248/ingest/9df62f0f-78c1-44fb-821f-c3c7b9f764cc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'meeting-super-agent-start.js:processor',message:'super_agent_assemblyai_error',data:{analysisId,error:error?.message,stack:error?.stack?.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H12g'})}).catch(()=>{});
    // #endregion
    await analysis.update({
      status: "error",
      errorMessage: error?.message || "Failed to submit transcription",
    });
  }
};

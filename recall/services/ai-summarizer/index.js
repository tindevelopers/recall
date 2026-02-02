import OpenAI from "../openai/index.js";
import AssemblyAI from "../assemblyai/index.js";
import Notepad from "../notepad/index.js";

/**
 * AI Summarizer Abstraction Layer
 * 
 * Provides a unified interface for multiple AI summarization providers
 * Supports: Recall.ai, OpenAI, AssemblyAI, Anthropic
 */
export default {
  /**
   * Get summary and action items using the configured provider
   * @param {Object} options - Configuration options
   * @param {string} options.provider - Provider name: 'recall', 'openai', 'assemblyai', 'anthropic'
   * @param {string} options.model - Model identifier (provider-specific)
   * @param {string} options.transcriptText - Transcript text to summarize
   * @param {Object} options.metadata - Meeting metadata
   * @param {Object} options.settings - Feature flags (enableSummary, enableActionItems, etc.)
   * @param {string} options.recallBotId - Recall.ai bot ID (if using Recall.ai)
   * @param {string} options.recallEventId - Recall.ai event ID (if using Recall.ai)
   * @param {Object} options.webhookPayload - Recall.ai webhook payload (if available)
   * @returns {Promise<Object>} Summary result with standardized format
   */
  async summarize({
    provider = "recall",
    model = null,
    transcriptText,
    metadata = {},
    settings = {},
    recallBotId = null,
    recallEventId = null,
    webhookPayload = null,
  }) {
    console.log(`[AI-SUMMARIZER] Using provider: ${provider}, model: ${model || "default"}`);

    switch (provider.toLowerCase()) {
      case "recall":
      case "recall.ai":
        // Use existing Notepad service which handles Recall.ai
        return await Notepad.getSummaryAndActionItems({
          transcriptText,
          metadata,
          settings,
          recallBotId,
          recallEventId,
          webhookPayload,
        });

      case "openai":
        // Use OpenAI directly
        const openaiModel = model || process.env.OPENAI_MODEL_SUMMARY || "gpt-4-turbo";
        return await this._summarizeWithOpenAI(transcriptText, metadata, settings, openaiModel);

      case "assemblyai":
        // Use AssemblyAI LLM Gateway
        const assemblyModel = model || "gpt-4";
        return await AssemblyAI.summarizeTranscript(transcriptText, metadata, {
          model: assemblyModel,
        });

      case "anthropic":
        // Use Anthropic Claude
        const anthropicModel = model || process.env.ANTHROPIC_MODEL || "claude-3-sonnet-20240229";
        return await this._summarizeWithAnthropic(transcriptText, metadata, settings, anthropicModel);

      default:
        throw new Error(`Unknown provider: ${provider}. Supported: recall, openai, assemblyai, anthropic`);
    }
  },

  /**
   * Summarize using OpenAI directly
   */
  async _summarizeWithOpenAI(transcriptText, metadata, settings, model) {
    const { chatCompletion } = OpenAI;
    
    // Reuse the prompt structure from Notepad service
    const title = metadata?.title || "Meeting";
    const participants = metadata?.participants || [];
    const when = metadata?.startTime || "";
    const speakerStats = metadata?.speakerStats || [];
    const durationSeconds = metadata?.durationSeconds || null;
    
    const participantNames = Array.isArray(participants)
      ? participants.map(p => p.name || p.email || p).filter(Boolean).join(", ")
      : "";
    
    const requestedOutputs = [];
    if (settings.enableSummary !== false) {
      requestedOutputs.push("summary: A comprehensive, well-structured summary");
    }
    if (settings.enableActionItems !== false) {
      requestedOutputs.push("action_items: Array of specific tasks/assignments");
    }
    if (settings.enableFollowUps !== false) {
      requestedOutputs.push("follow_ups: Array of suggested follow-up items");
    }
    requestedOutputs.push("topics: Array of main topics/themes discussed");
    requestedOutputs.push("highlights: Array of 5-10 concise bullets");
    requestedOutputs.push("detailed_notes: Array of 8-15 paraphrased quote-style bullets");
    requestedOutputs.push("stats: Object with lightweight stats");
    requestedOutputs.push("sentiment: Object with score, label, and confidence");
    requestedOutputs.push("key_insights: Array of key insights");
    requestedOutputs.push("decisions: Array of decisions made");
    requestedOutputs.push("outcome: Overall meeting outcome");

    const systemPrompt = `You are an expert meeting summarizer and analyst. Return valid JSON with these fields: ${requestedOutputs.map((o, i) => `${i + 1}. ${o.split(':')[0]}`).join(", ")}.`;

    const talkTimeHint = speakerStats && speakerStats.length
      ? `Speaker talk-time hints: ${speakerStats.map((s) => `${s.name || "Unknown"}: ${Math.round(s.talkTimeSeconds || 0)}s`).join("; ")}`
      : "Speaker talk-time hints: not available";

    const userMessage = `Meeting Details:
Title: ${title}
Date/Time: ${when}
Participants: ${participantNames || "Not specified"}
${durationSeconds ? `Estimated duration (seconds): ${durationSeconds}` : ""}
${talkTimeHint}

Transcript:
${transcriptText}

Please analyze this meeting transcript and provide a comprehensive summary with all requested outputs.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const response = await chatCompletion(messages, {
      responseFormat: "json_object",
      model: model,
      temperature: 0.3,
      maxTokens: 5500,
    });

    function safeParseJson(text) {
      try {
        return JSON.parse(text);
      } catch (err) {
        return null;
      }
    }

    const parsed = safeParseJson(response) || {};

    return {
      source: "openai",
      summary: settings.enableSummary !== false ? (parsed.summary || parsed.overview || "") : "",
      actionItems: settings.enableActionItems !== false ? (parsed.action_items || parsed.actions || []) : [],
      followUps: settings.enableFollowUps !== false ? (parsed.follow_ups || parsed.followups || []) : [],
      topics: parsed.topics || parsed.key_points || [],
      highlights: parsed.highlights || parsed.highlight_bullets || [],
      detailedNotes: parsed.detailed_notes || parsed.detailedNotes || parsed.notes_detailed || [],
      stats: parsed.stats || null,
      sentiment: parsed.sentiment || { score: 0, label: "neutral", confidence: 0.5 },
      keyInsights: parsed.key_insights || parsed.keyInsights || [],
      decisions: parsed.decisions || [],
      outcome: parsed.outcome || "informational",
    };
  },

  /**
   * Summarize using Anthropic Claude
   */
  async _summarizeWithAnthropic(transcriptText, metadata, settings, model) {
    const { chat } = await import("../llm/index.js");
    
    const title = metadata?.title || "Meeting";
    const participants = metadata?.participants || [];
    const participantNames = Array.isArray(participants)
      ? participants.map(p => p.name || p.email || p).filter(Boolean).join(", ")
      : "";

    const systemPrompt = `You are an expert meeting summarizer. Return valid JSON with: summary, action_items, follow_ups, topics, highlights, detailed_notes, stats, sentiment, key_insights, decisions, outcome.`;

    const userMessage = `Meeting: ${title}
Participants: ${participantNames || "Not specified"}

Transcript:
${transcriptText}

Analyze and provide comprehensive summary in JSON format.`;

    const messages = [
      { role: "user", content: userMessage },
    ];

    const response = await chat(messages, {
      model: model,
      responseFormat: "json_object",
      temperature: 0.3,
      maxTokens: 8000,
    });

    function safeParseJson(text) {
      try {
        return typeof text === "string" ? JSON.parse(text) : text;
      } catch (err) {
        return null;
      }
    }

    const parsed = safeParseJson(response) || {};

    return {
      source: "anthropic",
      summary: settings.enableSummary !== false ? (parsed.summary || "") : "",
      actionItems: settings.enableActionItems !== false ? (parsed.action_items || []) : [],
      followUps: settings.enableFollowUps !== false ? (parsed.follow_ups || []) : [],
      topics: parsed.topics || [],
      highlights: parsed.highlights || [],
      detailedNotes: parsed.detailed_notes || [],
      stats: parsed.stats || null,
      sentiment: parsed.sentiment || { score: 0, label: "neutral", confidence: 0.5 },
      keyInsights: parsed.key_insights || [],
      decisions: parsed.decisions || [],
      outcome: parsed.outcome || "informational",
    };
  },

  /**
   * Get available providers and their models
   */
  getAvailableProviders() {
    return {
      recall: {
        name: "Recall.ai",
        models: ["default"],
        description: "Recall.ai's built-in summarization",
      },
      openai: {
        name: "OpenAI",
        models: ["gpt-4-turbo", "gpt-4", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
        description: "OpenAI GPT models",
      },
      assemblyai: {
        name: "AssemblyAI",
        models: AssemblyAI.getAvailableModels(),
        description: "AssemblyAI LLM Gateway (supports GPT, Claude, Gemini)",
      },
      anthropic: {
        name: "Anthropic",
        models: ["claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307"],
        description: "Anthropic Claude models",
      },
    };
  },
};

import Recall from "../recall/index.js";
import { chatCompletion } from "../openai/index.js";

/**
 * Notepad Service
 * 
 * Primary: Uses Recall.ai Notepad API to get summaries and action items
 * Fallback: Uses OpenAI for additional processing or if Notepad API is unavailable
 */
export default {
  /**
   * Extract summaries and action items from Recall.ai webhook payload
   * Recall.ai may include summary/action items in the webhook data
   */
  extractFromWebhookPayload(payload) {
    const data = payload?.data || payload;
    
    // Check for Recall.ai's built-in summary/notes in webhook
    const summary = data?.summary || data?.notes?.summary || data?.notepad?.summary || null;
    const actionItems = data?.action_items || data?.notes?.action_items || data?.notepad?.action_items || [];
    const followUps = data?.follow_ups || data?.notes?.follow_ups || data?.notepad?.follow_ups || [];
    const topics = data?.topics || data?.notes?.topics || data?.notepad?.topics || [];
    
    if (summary || actionItems?.length > 0) {
      return {
        source: "recall_webhook",
        summary: summary || "",
        actionItems: Array.isArray(actionItems) ? actionItems : [],
        followUps: Array.isArray(followUps) ? followUps : [],
        topics: Array.isArray(topics) ? topics : [],
      };
    }
    
    return null;
  },

  /**
   * Fetch notes from Recall.ai Notepad API using bot ID
   */
  async fetchFromBotId(botId) {
    try {
      console.log(`[NOTEPAD] Attempting to fetch notes from Recall.ai for bot ${botId}`);
      const notes = await Recall.getBotNotes(botId);
      
      if (notes && (notes.summary || notes.action_items?.length > 0)) {
        console.log(`[NOTEPAD] Successfully fetched notes from Recall.ai Notepad API`);
        return {
          source: "recall_notepad_api",
          summary: notes.summary || notes.notes?.summary || "",
          actionItems: notes.action_items || notes.actionItems || notes.notes?.action_items || [],
          followUps: notes.follow_ups || notes.followUps || notes.notes?.follow_ups || [],
          topics: notes.topics || notes.notes?.topics || [],
        };
      }
      
      return null;
    } catch (err) {
      console.log(`[NOTEPAD] Recall.ai Notepad API not available: ${err.message}`);
      return null;
    }
  },

  /**
   * Fetch notes from Recall.ai using calendar event ID
   */
  async fetchFromEventId(eventId) {
    try {
      console.log(`[NOTEPAD] Attempting to fetch notes from Recall.ai for event ${eventId}`);
      const notes = await Recall.getCalendarEventNotes(eventId);
      
      if (notes && (notes.summary || notes.action_items?.length > 0)) {
        console.log(`[NOTEPAD] Successfully fetched notes from Recall.ai for event`);
        return {
          source: "recall_event_api",
          summary: notes.summary || notes.notes?.summary || "",
          actionItems: notes.action_items || notes.actionItems || notes.notes?.action_items || [],
          followUps: notes.follow_ups || notes.followUps || notes.notes?.follow_ups || [],
          topics: notes.topics || notes.notes?.topics || [],
        };
      }
      
      return null;
    } catch (err) {
      console.log(`[NOTEPAD] Recall.ai Event Notes API not available: ${err.message}`);
      return null;
    }
  },

  /**
   * Get summaries and action items - tries Recall.ai first, falls back to OpenAI
   */
  async getSummaryAndActionItems({
    transcriptText,
    metadata = {},
    settings = {},
    recallBotId = null,
    recallEventId = null,
    webhookPayload = null,
  }) {
    // Step 1: Try to extract from webhook payload (fastest, already received)
    if (webhookPayload) {
      const webhookData = this.extractFromWebhookPayload(webhookPayload);
      if (webhookData) {
        console.log(`[NOTEPAD] Using data from Recall.ai webhook payload`);
        return webhookData;
      }
    }

    // Step 2: Try Recall.ai Notepad API via bot ID
    if (recallBotId) {
      const botNotes = await this.fetchFromBotId(recallBotId);
      if (botNotes) {
        return botNotes;
      }
    }

    // Step 3: Try Recall.ai Notepad API via event ID
    if (recallEventId) {
      const eventNotes = await this.fetchFromEventId(recallEventId);
      if (eventNotes) {
        return eventNotes;
      }
    }

    // Step 4: Fallback to OpenAI for summarization
    console.log(`[NOTEPAD] Falling back to OpenAI for summarization`);
    const result = await this.getSummaryFromOpenAI(transcriptText, metadata, settings);
    return result;
  },

  /**
   * Use OpenAI to generate summary and action items (fallback method)
   */
  async getSummaryFromOpenAI(transcriptText, metadata = {}, settings = {}) {
    const title = metadata?.title || "Meeting";
    const participants = metadata?.participants || [];
    const when = metadata?.startTime || "";
    const speakerStats = metadata?.speakerStats || [];
    const durationSeconds = metadata?.durationSeconds || null;
    
    // Format participant names for better context
    const participantNames = Array.isArray(participants)
      ? participants.map(p => p.name || p.email || p).filter(Boolean).join(", ")
      : "";
    
    // Build the request based on what enrichment features are enabled
    const requestedOutputs = [];
    if (settings.enableSummary !== false) {
      requestedOutputs.push("summary: A comprehensive, well-structured summary that includes an executive overview (2-3 sentences), key discussion points with context, and important details. The summary should be immediately useful and scannable.");
    }
    if (settings.enableActionItems !== false) {
      requestedOutputs.push("action_items: Array of specific tasks/assignments mentioned, each with 'task' (clear description), 'assignee' (person responsible if mentioned), and 'due_date' (if mentioned). Extract commitments made by specific speakers.");
    }
    if (settings.enableFollowUps !== false) {
      requestedOutputs.push("follow_ups: Array of suggested follow-up items and next steps, including any commitments or promises made during the meeting");
    }
    requestedOutputs.push("topics: Array of main topics/themes discussed, with brief context for each");
    requestedOutputs.push("highlights: Array of 5-10 concise bullets focused on decisions, outcomes, risks, or major updates. Each item should include: title (short), summary (1-2 sentences), speaker (who drove it), timestamp_seconds (number or null), category (decision|risk|update|action|note), impact (high|medium|low).");
    requestedOutputs.push("detailed_notes: Array of 8-15 paraphrased quote-style bullets. Each item: speaker, paraphrase (1-2 sentences capturing meaning), quote (short optional verbatim phrase), topic, timestamp_seconds (number or null), importance (high|medium|low). Prefer high-signal statements over filler.");
    requestedOutputs.push("stats: Object with lightweight stats. Include duration_seconds if inferable, and speakers: [{ name, talk_time_seconds, talk_time_percent, turns }]. If timing data is unclear, provide a reasonable estimate and note it is estimated.");
    requestedOutputs.push("sentiment: Object with 'score' (-1 to 1, negative to positive), 'label' (negative/neutral/positive), and 'confidence' (0-1). Consider overall tone, language used, and emotional indicators");
    requestedOutputs.push("key_insights: Array of key insights, innovative ideas, important realizations, or valuable suggestions from the meeting, each with 'insight' (the idea) and 'importance' (high/medium/low)");
    requestedOutputs.push("decisions: Array of decisions made during the meeting, each with 'decision' (what was decided) and 'context' (who made it and why). Distinguish between actual decisions and discussions");
    requestedOutputs.push("outcome: Overall meeting outcome - one of: 'productive' (clear progress made, goals achieved), 'inconclusive' (discussion without clear resolution), 'needs_followup' (requires additional meetings or actions), 'blocked' (progress blocked by issues), 'informational' (primarily information sharing)");
    
    const systemPrompt = `You are an expert meeting summarizer and analyst with deep expertise in extracting actionable insights from business conversations. Your summaries are used by busy professionals who need to quickly understand what happened and what needs to happen next.

Your task is to analyze the meeting transcript and produce comprehensive, well-structured outputs. Pay close attention to:
- WHO said what (use speaker names from the transcript)
- WHAT was decided vs. what was discussed
- SPECIFIC commitments and action items with owners
- CONTEXT and background that makes the summary useful

Guidelines for the summary:
- Start with a 2-3 sentence executive overview that captures the meeting's purpose and outcome
- Organize key discussion points by topic with sufficient context
- Include who made important points or decisions
- Make it scannable but comprehensive - include enough detail to be useful
- Use clear, professional language

Guidelines for highlights:
- 5-10 bullets, concise and scannable
- Focus on decisions, agreements, risks, blockers, and major updates
- Include the driving speaker and a timestamp when available; otherwise set timestamp_seconds to null

Guidelines for detailed_notes (paraphrased quotes):
- 8-15 bullets capturing the most important spoken statements
- Paraphrase meaning in 1-2 sentences; include a short direct quote snippet when useful
- Include speaker and timestamp when available; otherwise set timestamp_seconds to null
- Prefer high-signal phrases, commitments, and nuanced points over generic chatter

Guidelines for stats:
- Include per-speaker talk time seconds and percent; add speaking turns if derivable
- If timing is missing, provide a coherent estimate and state that it is estimated

Guidelines for action items:
- Extract specific, actionable tasks mentioned in the conversation
- Identify the person responsible (if mentioned) by matching speaker names
- Include deadlines or timeframes if mentioned
- Distinguish between commitments and suggestions

Guidelines for decisions:
- Only include actual decisions made, not topics discussed
- Include who made the decision and the context/reasoning
- Be specific about what was decided

Guidelines for key insights:
- Focus on innovative ideas, important realizations, or valuable suggestions
- Rate importance based on potential impact
- Include insights that might not be obvious from a quick read

Return valid JSON with these fields: ${requestedOutputs.map((o, i) => `${i + 1}. ${o.split(':')[0]}`).join(", ")}. Be thorough and accurate - this summary will be used to make important decisions.`;

    // Format the user message with better structure
    const talkTimeHint =
      speakerStats && speakerStats.length
        ? `Speaker talk-time hints (seconds, may be approximate): ${speakerStats
            .map((s) => `${s.name || "Unknown"}: ${Math.round(s.talkTimeSeconds || 0)}s${s.talkTimePercent ? ` (${s.talkTimePercent.toFixed(1)}%)` : ""}`)
            .join("; ")}`
        : "Speaker talk-time hints: not available";

    const userMessage = `Meeting Details:
Title: ${title}
Date/Time: ${when}
Participants: ${participantNames || "Not specified"}
${durationSeconds ? `Estimated duration (seconds): ${durationSeconds}` : "Estimated duration: not available"}
${talkTimeHint}

Transcript:
${transcriptText}

Please analyze this meeting transcript and provide a comprehensive summary with all requested outputs. Pay special attention to speaker attribution, specific commitments, and decisions made.`;

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userMessage,
      },
    ];

    const response = await chatCompletion(messages, {
      responseFormat: "json_object",
      temperature: 0.3, // Lower temperature for more focused, factual summaries
      maxTokens: 5500, // Allow additional space for detailed sections
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
};

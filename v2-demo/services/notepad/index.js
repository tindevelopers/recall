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
    return await this.getSummaryFromOpenAI(transcriptText, metadata, settings);
  },

  /**
   * Use OpenAI to generate summary and action items (fallback method)
   */
  async getSummaryFromOpenAI(transcriptText, metadata = {}, settings = {}) {
    const title = metadata?.title || "Meeting";
    const participants = metadata?.participants || [];
    const when = metadata?.startTime || "";
    
    // Build the request based on what enrichment features are enabled
    const requestedOutputs = [];
    if (settings.enableSummary !== false) {
      requestedOutputs.push("summary: A concise summary of the key discussion points");
    }
    if (settings.enableActionItems !== false) {
      requestedOutputs.push("action_items: Array of specific tasks/assignments mentioned, each with 'task', 'assignee' (if mentioned), and 'due_date' (if mentioned)");
    }
    if (settings.enableFollowUps !== false) {
      requestedOutputs.push("follow_ups: Array of suggested follow-up items and next steps");
    }
    requestedOutputs.push("topics: Array of main topics/themes discussed");
    
    const systemPrompt = `You are an expert meeting summarizer. Analyze the meeting transcript and produce the following outputs:
${requestedOutputs.map((o, i) => `${i + 1}. ${o}`).join("\n")}

Return valid JSON with these fields. Be concise but thorough.`;

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            title,
            when,
            participants,
            transcript: transcriptText,
          },
          null,
          2
        ),
      },
    ];

    const response = await chatCompletion(messages, {
      responseFormat: "json_object",
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
    };
  },
};

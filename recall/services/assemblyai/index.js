import fetch from "node-fetch";

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || "0da92f32448e4d6b9a72f0006c7eaed2";
const ASSEMBLYAI_LLM_GATEWAY_URL = "https://llm-gateway.assemblyai.com/v1";

/**
 * AssemblyAI Service
 * 
 * Provides transcript summarization using AssemblyAI's LLM Gateway
 * Supports multiple LLM providers through AssemblyAI's unified interface
 */
export default {
  /**
   * Summarize transcript using AssemblyAI's LLM Gateway
   * @param {string} transcriptText - The transcript text to summarize
   * @param {Object} metadata - Meeting metadata (title, participants, etc.)
   * @param {Object} options - Configuration options
   * @param {string} options.model - LLM model to use (gpt-4, gpt-3.5-turbo, claude-3-opus, claude-3-sonnet, claude-3-haiku, gemini-pro)
   * @param {string} options.summaryType - Summary format (paragraph, bullets, headline)
   * @param {string} options.summaryModel - Summary style (informative, conversational)
   * @returns {Promise<Object>} Summary result with all requested fields
   */
  async summarizeTranscript(transcriptText, metadata = {}, options = {}) {
    if (!ASSEMBLYAI_API_KEY) {
      throw new Error("ASSEMBLYAI_API_KEY is not configured");
    }

    const {
      model = "gpt-4",
      summaryType = "bullets",
      summaryModel = "informative",
    } = options;

    const title = metadata?.title || "Meeting";
    const participants = metadata?.participants || [];
    const participantNames = Array.isArray(participants)
      ? participants.map(p => p.name || p.email || p).filter(Boolean).join(", ")
      : "";

    // Build comprehensive prompt for structured output
    const systemPrompt = `You are an expert meeting summarizer and analyst with deep expertise in extracting actionable insights from business conversations. Your summaries are used by busy professionals who need to quickly understand what happened and what needs to happen next.

Your task is to analyze the meeting transcript and produce comprehensive, well-structured outputs. Pay close attention to:
- WHO said what (use speaker names from the transcript)
- WHAT was decided vs. what was discussed
- SPECIFIC commitments and action items with owners
- CONTEXT and background that makes the summary useful

Return valid JSON with these fields:
1. summary: A comprehensive, well-structured summary that includes an executive overview (2-3 sentences), key discussion points with context, and important details. The summary should be immediately useful and scannable.
2. action_items: Array of specific tasks/assignments mentioned, each with 'task' (clear description), 'assignee' (person responsible if mentioned), and 'due_date' (if mentioned). Extract commitments made by specific speakers.
3. follow_ups: Array of suggested follow-up items and next steps, including any commitments or promises made during the meeting
4. topics: Array of main topics/themes discussed, each with 'title' (topic name) and 'items' (array of bullet points with details and timestamps if available)
5. highlights: Array of 5-10 concise bullets focused on decisions, outcomes, risks, or major updates. Each item should include: title (short), summary (1-2 sentences), speaker (who drove it), timestamp_seconds (number or null), category (decision|risk|update|action|note), impact (high|medium|low).
6. detailed_notes: Array of 8-15 paraphrased quote-style bullets. Each item: speaker, paraphrase (1-2 sentences capturing meaning), quote (short optional verbatim phrase), topic, timestamp_seconds (number or null), importance (high|medium|low). Prefer high-signal statements over filler.
7. stats: Object with lightweight stats. Include duration_seconds if inferable, and speakers: [{ name, talk_time_seconds, talk_time_percent, turns }]. If timing data is unclear, provide a reasonable estimate and note it is estimated.
8. sentiment: Object with 'score' (-1 to 1, negative to positive), 'label' (negative/neutral/positive), and 'confidence' (0-1). Consider overall tone, language used, and emotional indicators
9. key_insights: Array of key insights, innovative ideas, important realizations, or valuable suggestions from the meeting, each with 'insight' (the idea) and 'importance' (high/medium/low)
10. decisions: Array of decisions made during the meeting, each with 'decision' (what was decided) and 'context' (who made it and why). Distinguish between actual decisions and discussions
11. outcome: Overall meeting outcome - one of: 'productive' (clear progress made, goals achieved), 'inconclusive' (discussion without clear resolution), 'needs_followup' (requires additional meetings or actions), 'blocked' (progress blocked by issues), 'informational' (primarily information sharing)

Be thorough and accurate - this summary will be used to make important decisions.`;

    const userMessage = `Meeting Details:
Title: ${title}
Participants: ${participantNames || "Not specified"}
${metadata.durationSeconds ? `Estimated duration (seconds): ${metadata.durationSeconds}` : ""}

Transcript:
${transcriptText}

Please analyze this meeting transcript and provide a comprehensive summary with all requested outputs. Pay special attention to speaker attribution, specific commitments, and decisions made.`;

    try {
      // Use AssemblyAI's LLM Gateway endpoint for chat completions
      const response = await fetch(`${ASSEMBLYAI_LLM_GATEWAY_URL}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: ASSEMBLYAI_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 8000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ASSEMBLYAI] API error (${response.status}):`, errorText);
        throw new Error(`AssemblyAI API failed (${response.status}): ${errorText || "unknown"}`);
      }

      const json = await response.json();
      // AssemblyAI LLM Gateway returns standard OpenAI-compatible format
      const content = json.choices?.[0]?.message?.content || json.response || json.text || "";

      if (!content) {
        throw new Error("AssemblyAI returned empty response");
      }

      // Parse JSON response
      let parsed;
      try {
        parsed = typeof content === "string" ? JSON.parse(content) : content;
      } catch (parseError) {
        console.error("[ASSEMBLYAI] Failed to parse JSON response:", parseError);
        throw new Error("AssemblyAI returned invalid JSON");
      }

      // Normalize response format to match expected structure
      return {
        source: "assemblyai",
        summary: parsed.summary || parsed.overview || "",
        actionItems: parsed.action_items || parsed.actionItems || parsed.actions || [],
        followUps: parsed.follow_ups || parsed.followUps || parsed.followups || [],
        topics: parsed.topics || parsed.key_points || [],
        highlights: parsed.highlights || parsed.highlight_bullets || [],
        detailedNotes: parsed.detailed_notes || parsed.detailedNotes || parsed.notes_detailed || [],
        stats: parsed.stats || null,
        sentiment: parsed.sentiment || { score: 0, label: "neutral", confidence: 0.5 },
        keyInsights: parsed.key_insights || parsed.keyInsights || [],
        decisions: parsed.decisions || [],
        outcome: parsed.outcome || "informational",
      };
    } catch (error) {
      console.error("[ASSEMBLYAI] Summarization error:", error);
      throw error;
    }
  },

  /**
   * Get available models from AssemblyAI
   * @returns {Array<string>} List of available model names
   */
  getAvailableModels() {
    return [
      "gpt-4",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "claude-3-opus",
      "claude-3-sonnet",
      "claude-3-haiku",
      "gemini-pro",
    ];
  },
};

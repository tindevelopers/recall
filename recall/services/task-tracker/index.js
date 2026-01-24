const COMPLETION_KEYWORDS = ["completed", "done", "finished", "resolved", "fixed"];

function normalize(text = "") {
  return text.toLowerCase();
}

function isItemCompleted(itemText, transcript) {
  const normItem = normalize(itemText);
  const normTranscript = normalize(transcript);

  if (!normItem || !normTranscript) return false;

  const hasKeyword = COMPLETION_KEYWORDS.some((kw) =>
    normTranscript.includes(kw)
  );

  if (!hasKeyword) return false;

  // Loose containment check
  const words = normItem.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return words && normTranscript.includes(words);
}

/**
 * Given action items and a transcript, infer completion states.
 * Returns array of updates: { id, status, completedAt }
 */
function detectCompletions(actionItems = [], transcriptText = "") {
  if (!transcriptText) return [];
  const now = new Date();

  return actionItems
    .filter((ai) => ai?.id && ai?.status === "pending" && ai?.text)
    .filter((ai) => isItemCompleted(ai.text, transcriptText))
    .map((ai) => ({
      id: ai.id,
      status: "completed",
      completedAt: now,
    }));
}

export { detectCompletions };


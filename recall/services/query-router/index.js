import { chat as llmChat } from "../llm/index.js";
import { estimateTokensFromMessages, recordCost } from "../llm/cost-tracker.js";

const SIMPLE_MODEL = process.env.LLM_SIMPLE_MODEL || "gpt-3.5-turbo";
const COMPLEX_MODEL = process.env.LLM_COMPLEX_MODEL || "gpt-4o-mini";

function classifyQuery(query = "") {
  const text = (query || "").toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const complexSignals = ["why", "how", "plan", "root cause", "summarize"];
  const hasComplexSignal = complexSignals.some((s) => text.includes(s));

  if (wordCount > 40 || hasComplexSignal) {
    return "complex";
  }
  return "simple";
}

function selectModel(query) {
  const complexity = classifyQuery(query);
  return complexity === "complex" ? COMPLEX_MODEL : SIMPLE_MODEL;
}

async function chatWithRouter(messages, { query }) {
  const model = selectModel(query);
  const response = await llmChat(messages, { model, responseFormat: null });

  // Rough cost tracking
  const inputTokens = estimateTokensFromMessages(messages);
  const outputTokens = Math.ceil(String(response || "").length / 4);
  recordCost(model, { inputTokens, outputTokens });

  return { response, model };
}

export { classifyQuery, selectModel, chatWithRouter };


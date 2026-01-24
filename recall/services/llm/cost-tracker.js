const PRICING_PER_1K = {
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
};

function estimateTokensFromMessages(messages = []) {
  const text = messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  return Math.ceil(text.length / 4); // rough heuristic
}

function estimateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING_PER_1K[model];
  if (!pricing) return { cost: 0, pricingKnown: false };
  const cost =
    ((inputTokens / 1000) * pricing.input || 0) +
    ((outputTokens / 1000) * pricing.output || 0);
  return { cost, pricingKnown: true, pricing };
}

function recordCost(model, { inputTokens, outputTokens }) {
  const { cost, pricingKnown, pricing } = estimateCost(
    model,
    inputTokens,
    outputTokens
  );
  const meta = {
    model,
    inputTokens,
    outputTokens,
    cost,
    pricingKnown,
    pricing,
  };
  console.log("[llm-cost]", JSON.stringify(meta));
  return meta;
}

export { estimateTokensFromMessages, recordCost };


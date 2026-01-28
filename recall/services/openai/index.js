import fetch from "node-fetch";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHAT_MODEL = process.env.OPENAI_MODEL_SUMMARY || "gpt-4-turbo";
const EMBEDDING_MODEL =
  process.env.OPENAI_MODEL_EMBEDDINGS || "text-embedding-3-small";
const DEFAULT_TEMPERATURE = parseFloat(process.env.OPENAI_TEMPERATURE || "0.3");
const DEFAULT_MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS || "4000", 10);

if (!OPENAI_API_KEY) {
  console.warn(
    "⚠️  OPENAI_API_KEY is not set. OpenAI-dependent features will fail."
  );
}

function normalizeTexts(texts = []) {
  return texts
    .filter((t) => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

async function chatCompletion(
  messages,
  { 
    responseFormat = "json_object", 
    model = CHAT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
  } = {}
) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format:
      responseFormat === "json_object"
        ? { type: "json_object" }
        : undefined,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `OpenAI chatCompletion failed (${res.status}): ${text || "unknown"}`
    );
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content;
}

async function embed(texts = []) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const normalizedTexts = normalizeTexts(texts);
  if (!normalizedTexts.length) return [];

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: normalizedTexts,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `OpenAI embeddings failed (${res.status}): ${text || "unknown"}`
    );
  }

  const json = await res.json();
  return json.data?.map((d) => d.embedding) || [];
}

export { chatCompletion, embed };



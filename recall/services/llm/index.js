import fetch from "node-fetch";
import { chatCompletion as openAIChat, embed as openAIEmbed } from "../openai/index.js";

const LLM_PROVIDER = process.env.LLM_PROVIDER || "openai";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";

function getProvider() {
  if (LLM_PROVIDER === "anthropic" && ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  return "openai";
}

function toAnthropicMessages(messages = []) {
  const systemParts = messages
    .filter((m) => m.role === "system" && typeof m.content === "string")
    .map((m) => m.content.trim());

  const nonSystem = messages.filter((m) => m.role !== "system");

  return {
    system: systemParts.join("\n\n") || undefined,
    messages: nonSystem.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: [{ type: "text", text: String(m.content ?? "") }],
    })),
  };
}

async function anthropicChat(messages, { maxTokens = 512 } = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const { system, messages: mappedMessages } = toAnthropicMessages(messages);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: mappedMessages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Anthropic chat failed (${res.status}): ${text || "unknown"}`
    );
  }

  const json = await res.json();
  return json?.content?.[0]?.text || "";
}

async function chat(messages, options = {}) {
  const provider = getProvider();
  if (provider === "anthropic") {
    try {
      return await anthropicChat(messages, options);
    } catch (err) {
      console.warn(
        "[llm] Anthropic chat failed, falling back to OpenAI:",
        err?.message || err
      );
    }
  }

  // Default to OpenAI
  return openAIChat(messages, options);
}

export { chat, openAIEmbed as embed, getProvider };


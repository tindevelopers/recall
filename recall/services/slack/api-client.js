import fetch from "node-fetch";

/**
 * Post a message to Slack via Incoming Webhook.
 */
export async function postMessage({ webhookUrl, text, blocks }) {
  if (!webhookUrl) {
    throw new Error("Slack webhookUrl is required");
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text || "New meeting summary",
      blocks,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(
      `Slack request failed (${res.status}): ${body || "unknown"}`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return true;
}




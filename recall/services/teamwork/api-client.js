import fetch from "node-fetch";

/**
 * Minimal Teamwork client to create a task.
 * Assumes `baseUrl` like https://yourcompany.teamwork.com
 */
export async function createTask({ baseUrl, apiKey, content, description }) {
  if (!baseUrl || !apiKey) {
    throw new Error("Teamwork baseUrl and apiKey are required");
  }

  const auth = Buffer.from(`${apiKey}:x`).toString("base64");
  const res = await fetch(`${baseUrl}/tasks.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      todo-item: {
        content,
        description,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(
      `Teamwork request failed (${res.status}): ${body || "unknown"}`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return await res.json();
}



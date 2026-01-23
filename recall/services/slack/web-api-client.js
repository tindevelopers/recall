import fetch from "node-fetch";

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function slackApi({ token, path, method = "GET", body }) {
  const res = await fetch(`https://slack.com/api/${path}`, {
    method,
    headers: authHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) {
    const err = new Error(json.error || "Slack API error");
    err.data = json;
    throw err;
  }
  return json;
}

export async function listConversations({ token, types = "public_channel,private_channel" }) {
  return slackApi({
    token,
    path: `conversations.list?types=${encodeURIComponent(types)}&limit=200`,
  });
}

export async function createConversation({ token, name, isPrivate = false }) {
  return slackApi({
    token,
    path: "conversations.create",
    method: "POST",
    body: { name, is_private: isPrivate },
  });
}

export async function inviteToConversation({ token, channel, users }) {
  return slackApi({
    token,
    path: "conversations.invite",
    method: "POST",
    body: { channel, users: Array.isArray(users) ? users.join(",") : users },
  });
}

export async function listUsers({ token }) {
  return slackApi({ token, path: "users.list?limit=200" });
}

export async function postMessage({ token, channel, text, blocks, thread_ts }) {
  return slackApi({
    token,
    path: "chat.postMessage",
    method: "POST",
    body: { channel, text, blocks, thread_ts },
  });
}

import fetch from "node-fetch";

/**
 * Lightweight Slack Web API client for bot token calls.
 */
const BASE_URL = "https://slack.com/api";

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function slackRequest({ token, path, method = "GET", body, query }) {
  const url = new URL(`${BASE_URL}/${path}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
  }

  const res = await fetch(url.toString(), {
    method,
    headers: authHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!json.ok) {
    const err = new Error(
      `Slack API error for ${path}: ${json.error || "unknown_error"}`
    );
    err.data = json;
    throw err;
  }
  return json;
}

export async function listConversations(token, { limit = 1000 } = {}) {
  return slackRequest({
    token,
    path: "conversations.list",
    query: { limit, types: "public_channel,private_channel" },
  });
}

export async function createConversation(token, { name, isPrivate = false }) {
  return slackRequest({
    token,
    path: "conversations.create",
    method: "POST",
    body: { name, is_private: isPrivate },
  });
}

export async function inviteUsers(token, { channel, users }) {
  return slackRequest({
    token,
    path: "conversations.invite",
    method: "POST",
    body: { channel, users },
  });
}

export async function listUsers(token, { limit = 200 } = {}) {
  return slackRequest({
    token,
    path: "users.list",
    query: { limit },
  });
}

export async function postMessage(token, { channel, text, blocks, threadTs }) {
  return slackRequest({
    token,
    path: "chat.postMessage",
    method: "POST",
    body: {
      channel,
      text: text || "New meeting",
      blocks,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    },
  });
}



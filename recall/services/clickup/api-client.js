import fetch from "node-fetch";

const BASE = "https://api.clickup.com/api/v2";

function headers(token) {
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

async function cuRequest({ token, path, method = "GET", body }) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`ClickUp request failed (${res.status}): ${text || "unknown"}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

export async function listTeams(token) {
  return cuRequest({ token, path: "/team" });
}

export async function listSpaces(token, teamId) {
  return cuRequest({ token, path: `/team/${teamId}/space` });
}

export async function listFolders(token, spaceId) {
  return cuRequest({ token, path: `/space/${spaceId}/folder` });
}

export async function listLists(token, folderId) {
  return cuRequest({ token, path: `/folder/${folderId}/list` });
}

export async function createTask(token, { listId, name, description, milestone = false }) {
  if (!listId) throw new Error("listId is required");
  return cuRequest({
    token,
    path: `/list/${listId}/task`,
    method: "POST",
    body: {
      name,
      description,
      milestone,
    },
  });
}



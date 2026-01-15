const RECALL_API_HOST = process.env.REACT_APP_RECALL_API_HOST || "https://recall-one-sigma.vercel.app";
const RECALL_CALENDAR_API_NAMESPACE = "api/v1/calendar";
const GOOGLE_OAUTH_PERMISSION_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];
const MS_OAUTH_PERMISSION_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "https://graph.microsoft.com/Calendars.Read",
];

type RequestMethod = "POST" | "GET" | "PUT" | "DELETE";
type MakeRequestArgument = {
  url: string;
  token?: string;
  method: RequestMethod;
  data?: object;
};

export async function makeRequest<T>({
  url,
  token,
  method,
  data,
}: MakeRequestArgument): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-RecallCalendarAuthToken": token } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return await res.json();
}

export function buildUrl(
  path: string,
  host: string = RECALL_API_HOST,
  namespace: string = RECALL_CALENDAR_API_NAMESPACE
) {
  return `${host}/${namespace}/${path}`;
}

type BuildGoogleOAuthUrlArgs = {
  state: object;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
};
export function buildGoogleOAuthUrl({
  state,
  clientId,
  redirectUri,
  scopes = GOOGLE_OAUTH_PERMISSION_SCOPES,
}: BuildGoogleOAuthUrlArgs): string {
  // Trim whitespace and newlines from clientId and redirectUri (common issue with env vars)
  const cleanClientId = clientId.trim();
  const cleanRedirectUri = redirectUri.trim();
  
  const params = new URLSearchParams({
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    response_type: "code",
    state: JSON.stringify(state),
    redirect_uri: cleanRedirectUri,
    client_id: cleanClientId,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type BuildMSOAuthUrlArgs = {
  state: object;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
};

export function buildMSOAuthUrl({
  state,
  clientId,
  redirectUri,
  scopes = MS_OAUTH_PERMISSION_SCOPES,
}: BuildMSOAuthUrlArgs) {
  // Trim whitespace and newlines from clientId (common issue with env vars)
  const cleanClientId = clientId.trim();
  
  // Ensure redirect_uri is a valid absolute URI and remove trailing slash if present
  const cleanRedirectUri = redirectUri.trim().replace(/\/$/, "");
  if (!cleanRedirectUri.startsWith("http://") && !cleanRedirectUri.startsWith("https://")) {
    throw new Error(`redirect_uri must be an absolute URI, got: ${redirectUri}`);
  }
  
  // Manually construct query string with proper encoding
  const params = [
    `client_id=${encodeURIComponent(cleanClientId)}`,
    `response_type=code`,
    `prompt=consent`,
    `redirect_uri=${encodeURIComponent(cleanRedirectUri)}`,
    `response_mode=query`,
    `scope=${encodeURIComponent(scopes.join(" "))}`,
    `state=${encodeURIComponent(JSON.stringify(state))}`,
  ].join("&");
  
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

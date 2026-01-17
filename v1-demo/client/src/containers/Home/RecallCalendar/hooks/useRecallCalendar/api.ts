const RECALL_API_HOST = process.env.REACT_APP_RECALL_API_HOST || "https://api.recall.ai";
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
  // DISCONNECTED FROM RECALL: Returning mock data instead of calling Recall API
  console.log(`[MOCK] makeRequest called: ${method} ${url}`, { token, data });
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Return mock data based on URL pattern
  if (url.includes('/user/')) {
    if (method === 'GET') {
      return {
        id: 'mock-user-id',
        external_id: 'mock-external-id',
        connections: [],
        preferences: {
          record_non_host: false,
          record_recurring: false,
          record_external: false,
          record_internal: false,
          record_confirmed: false,
          record_only_host: false,
          bot_name: 'Mock Bot',
        },
      } as T;
    } else if (method === 'PUT') {
      // Return updated user with preferences from data
      return {
        id: 'mock-user-id',
        external_id: 'mock-external-id',
        connections: [],
        preferences: (data as any)?.preferences || {
          record_non_host: false,
          record_recurring: false,
          record_external: false,
          record_internal: false,
          record_confirmed: false,
          record_only_host: false,
          bot_name: 'Mock Bot',
        },
      } as T;
    } else if (method === 'DELETE') {
      return {} as T;
    }
  } else if (url.includes('/meetings/')) {
    if (method === 'GET') {
      return [] as T; // Empty meetings array
    } else if (method === 'POST' && url.includes('/refresh')) {
      return [] as T; // Empty meetings array after refresh
    } else if (method === 'PUT') {
      // Return updated meeting
      const meetingId = url.split('/meetings/')[1]?.split('/')[0];
      return {
        id: meetingId || 'mock-meeting-id',
        override_should_record: (data as any)?.override_should_record || false,
        title: 'Mock Meeting',
        platform: 'zoom',
        meeting_platform: 'zoom',
        calendar_platform: 'google',
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + 3600000).toISOString(),
        will_record: false,
        will_record_reason: 'Mock meeting',
        bot_id: null,
      } as T;
    }
  }
  
  // Default mock response
  return {} as T;
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

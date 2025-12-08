class RecallApi {
  constructor({ apiKey, apiHost }) {
    this.apiKey = apiKey;
    this.apiHost = apiHost;
  }

  buildUrl(path, queryParams) {
    // Remove trailing slash from apiHost and leading slash from path to avoid double slashes
    const cleanHost = this.apiHost.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${cleanHost}${cleanPath}`);
    url.search = new URLSearchParams(queryParams).toString();
    return url.toString();
  }

  async request({
    path = null,
    url = null,
    method,
    data,
    headers = {},
    queryParams = {},
  }) {
    if (!url) {
      url = this.buildUrl(path, queryParams);
    }

    console.log(`Making ${method} request to ${url} with token ${this.apiKey}...`);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Token ${this.apiKey}`,
          "content-type": "application/json",
          ...headers,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    } catch (fetchError) {
      console.error(`[ERROR] Fetch failed for ${method} ${url}:`, fetchError);
      console.error(`[ERROR] Error details:`, {
        message: fetchError.message,
        cause: fetchError.cause,
        stack: fetchError.stack
      });
      throw new Error(`Failed to connect to Recall API: ${fetchError.message}`);
    }

    if (res.status > 299) {
      const body = await res.text();
      const err = new Error(
        `${method} request failed with status ${res.status}, response body: \n\n${res.status < 500 ? body : res.status}`
      );
      err.res = res;
      throw err;
    }

    if (res.body === null) {
      return
    } else {
      return await res.json();
    }
  }
}

let apiClient = null;
export function getClient() {
  if (apiClient) {
    return apiClient;
  }

  apiClient = new RecallApi({
    apiKey: process.env.RECALL_API_KEY,
    apiHost: process.env.RECALL_API_HOST,
  });
  return apiClient;
}

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

    // Avoid log spam / leaking tokens; log only host + path.
    try {
      const parsedUrl = new URL(url);
      console.log(`Making ${method} request to ${parsedUrl.origin}${parsedUrl.pathname}`);
    } catch {
      console.log(`Making ${method} request to ${url}`);
    }
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
      
      // #region agent log
      fetch('http://127.0.0.1:7250/ingest/bf0206c3-6e13-4499-92a3-7fb2b7527fcf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/recall/api-client.js:http_error',message:'HTTP error from Recall API',data:{method:method,path:path||url,status:res.status,statusText:res.statusText,bodyPreview:body.substring(0,500),bodyLength:body.length},timestamp:Date.now(),sessionId:'debug-session',runId:'bot-schedule',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      const err = new Error(
        `${method} request failed with status ${res.status}, response body: \n\n${res.status < 500 ? body : res.status}`
      );
      err.res = res;
      err.body = body;
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

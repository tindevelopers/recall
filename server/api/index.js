const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

// https://www.npmjs.com/package/node-fetch#commonjs
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors());
app.use(bodyParser.json());

// enable pre-flight
app.options("*", cors());

// GET route handler for health checks and browser access
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Recall Calendar Authentication Server",
    endpoint: "POST /",
  });
});

app.post("/", (req, res) => {
  console.log(
    `INFO: Received authenticate request with body: ${JSON.stringify(req.body)}`
  );

  // Get and sanitize API key - remove quotes, whitespace, and invalid header characters
  let apiKey = process.env.RECALL_API_KEY ? String(process.env.RECALL_API_KEY).trim() : null;
  if (apiKey) {
    // Remove surrounding quotes if present
    apiKey = apiKey.replace(/^["']|["']$/g, '');
    // Remove any invalid characters for HTTP headers (control characters, newlines, etc.)
    apiKey = apiKey.replace(/[\r\n\t\x00-\x1F\x7F]/g, '');
    apiKey = apiKey.trim();
  }
  
  const apiHost = (process.env.RECALL_API_HOST || "https://us-west-2.recall.ai").trim();
  // Remove surrounding quotes from host if present
  const cleanApiHost = apiHost.replace(/^["']|["']$/g, '').trim();

  console.log(`DEBUG: API Key exists: ${!!apiKey}`);
  console.log(`DEBUG: API Key length: ${apiKey ? apiKey.length : 0}`);
  console.log(`DEBUG: API Host: ${cleanApiHost}`);

  if (!apiKey) {
    console.error("ERROR: RECALL_API_KEY is not set");
    return res.status(500).json({ error: "Server configuration error: RECALL_API_KEY missing" });
  }

  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    console.error("ERROR: RECALL_API_KEY is invalid");
    return res.status(500).json({ error: "Server configuration error: RECALL_API_KEY invalid" });
  }

  // Clean the authorization header to ensure no invalid characters
  const authHeader = `Token ${apiKey}`;
  console.log(`DEBUG: Auth header prepared, length: ${authHeader.length}`);

  fetch(`${cleanApiHost}/api/v1/calendar/authenticate/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({ user_id: req.body.userId }),
  })
    .then(async (fetchRes) => {
      console.log(`DEBUG: Recall API response status: ${fetchRes.status}`);
      const data = await fetchRes.json();
      console.log(
        `INFO: Received authenticate response from server ${JSON.stringify(
          data
        )}`
      );
      
      if (!fetchRes.ok) {
        console.error(`ERROR: Recall API returned ${fetchRes.status}: ${JSON.stringify(data)}`);
        return res.status(fetchRes.status).json({ 
          error: "Failed to authenticate with Recall API",
          details: data 
        });
      }
      
      return res.json(data);
    })
    .catch((error) => {
      console.error(
        `ERROR: Failed to authenticate calendar v1 request due to ${error.message || error}`
      );
      console.error(`ERROR: Stack trace: ${error.stack}`);
      return res.status(500).json({ 
        error: "Failed to authenticate",
        message: error.message || String(error)
      });
    });
});

// Export the Express app as a serverless function
module.exports = app;

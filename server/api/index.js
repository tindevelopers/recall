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

  const apiKey = process.env.RECALL_API_KEY;
  const apiHost = process.env.RECALL_API_HOST || "https://us-west-2.recall.ai";

  if (!apiKey) {
    console.error("ERROR: RECALL_API_KEY is not set");
    return res.status(500).json({ error: "Server configuration error" });
  }

  console.log(`INFO: Using API Host: ${apiHost}`);

  fetch(`${apiHost}/api/v1/calendar/authenticate/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${apiKey}`,
    },
    body: JSON.stringify({ user_id: req.body.userId }),
  })
    .then((res) => res.json())
    .then((data) => {
      console.log(
        `INFO: Received authenicate response from server ${JSON.stringify(
          data
        )}`
      );
      return res.json(data);
    })
    .catch((error) => {
      console.log(
        `ERROR: Failed to authenticate calendar v1 request due to ${error}`
      );
      return res.status(500).json({ error: "Failed to authenticate" });
    });
});

// Export the Express app as a serverless function
module.exports = app;

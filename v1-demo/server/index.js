const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

// https://www.npmjs.com/package/node-fetch#commonjs
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

require("dotenv").config();

const app = express();

app.use(cors());
app.use(bodyParser.json());

// enable pre-flight
app.options("*", cors());

app.post("/", (req, res) => {
  console.log(
    `INFO: Received authenticate request with body: ${JSON.stringify(req.body)}`
  );

  // DISCONNECTED FROM RECALL: Returning mock token instead of calling Recall API
  const mockToken = `mock-token-${req.body.userId || 'default'}-${Date.now()}`;
  const mockResponse = {
    token: mockToken
  };

  console.log(
    `INFO: Returning mock token response (disconnected from Recall): ${JSON.stringify(mockResponse)}`
  );
  return res.json(mockResponse);
});

app.listen(process.env.PORT, () => {
  console.log(
    `INFO: Calendar v1 demo server is running on port ${process.env.PORT}`
  );
});

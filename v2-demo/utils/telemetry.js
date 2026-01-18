export async function telemetryEvent(message, data = {}, meta = {}) {
  const payload = {
    message,
    data,
    ...meta,
    timestamp: Date.now(),
    service: process.env.RAILWAY_SERVICE_NAME || "local",
    environment: process.env.NODE_ENV || "development",
  };

  // If configured, POST to an ingest URL; otherwise log to stdout (Railway captures this).
  const ingestUrl = process.env.DEBUG_INGEST_URL;
  if (ingestUrl) {
    try {
      await fetch(ingestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return;
    } catch {
      // fall through to stdout
    }
  }

  // One line JSON to be log-aggregation friendly.
  console.log(`[TELEMETRY] ${JSON.stringify(payload)}`);
}


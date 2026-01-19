// Minimal env typing to access CRA env vars without pulling Node types.
declare const process: { env: Record<string, string | undefined> };

type TelemetryPayload = Record<string, unknown> | undefined;

const TELEMETRY_URL = (process.env.REACT_APP_TELEMETRY_URL || "").trim();
const telemetryEnabled = TELEMETRY_URL.length > 0;

// Schedule work off the critical path.
function schedule(fn: () => void) {
  if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(fn, { timeout: 1000 });
  } else {
    setTimeout(fn, 0);
  }
}

export function track(event: string, payload?: TelemetryPayload) {
  if (!telemetryEnabled) return;

  const body = JSON.stringify({
    event,
    payload,
    ts: Date.now(),
  });

  schedule(() => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(TELEMETRY_URL, blob);
        return;
      }

      fetch(TELEMETRY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
        keepalive: true,
        credentials: "omit",
      }).catch(() => {});
    } catch {
      // Swallow telemetry errors to avoid impacting UX.
    }
  });
}


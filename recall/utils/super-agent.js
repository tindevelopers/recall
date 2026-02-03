/**
 * Whether Super Agent (AssemblyAI premium analysis) is enabled.
 * Enabled if:
 * - The calendar has enableSuperAgent set to true (Settings → Bot Settings), or
 * - SUPER_AGENT_ENABLED env is truthy: "true", "1", or "yes" (case-insensitive).
 *
 * @param {import('../models/calendar.js')} [calendar] - Optional calendar instance (may have enableSuperAgent).
 * @returns {boolean}
 */
export function isSuperAgentEnabled(calendar = null) {
  if (calendar && calendar.enableSuperAgent === true) {
    return true;
  }
  const v = (process.env.SUPER_AGENT_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

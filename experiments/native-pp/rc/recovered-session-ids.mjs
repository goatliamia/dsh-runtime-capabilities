// recovered-session-ids.mjs — round-2 concurrency-incident recovery map.
// Another session sanitized this repo mid-matrix (2026-09-02 21:31:44),
// redacting session ids in 5 cells created before that moment. The ids were
// recovered from the isolated-home sessions directory timestamps, anchored by
// the unredacted rccancel-xm1 id (session-ff267f3a...) whose dir/log mtimes
// chain exactly through the five windows.
export const RECOVERED_SESSION_IDS = {
  "rc-c1f": "session-<redacted>",
  "rc-cp1": "session-<redacted>",
  "rc-cp2": "session-<redacted>",
  "rccancel-x1": "session-<redacted>",
  "rccancel-x2": "session-<redacted>",
};

export function effectiveSessionId(run, metricsSessionId) {
  if (metricsSessionId && String(metricsSessionId).includes("redacted")) {
    return RECOVERED_SESSION_IDS[run] ?? metricsSessionId;
  }
  return metricsSessionId;
}

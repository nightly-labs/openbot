export const scriptedCases = [
  "chat",
  "queue",
  "restart",
  "create-agent",
  "delegate",
  "child-failure",
  "group",
  "routines",
  "schedule",
  "files",
  "browser",
  "takeover",
  "approval-accept",
  "approval-decline",
  "question",
  "reconnect",
] as const;
export const liveCases = ["live-codex", "live-claude", "live-opencode", "live-group"] as const;

export function releaseCoverage(results: readonly { id: string; mode: string; status: string }[], elapsedMs: number) {
  const missing = ["local", "host"].flatMap((mode) =>
    [...scriptedCases, ...liveCases]
      .filter((id) => !results.some((entry) => entry.mode === mode && entry.id === id && entry.status === "passed"))
      .map((id) => `${mode}/${id}`),
  );
  return {
    missing,
    passed: missing.length === 0 && elapsedMs <= 600_000 && results.every((entry) => entry.status === "passed"),
  };
}

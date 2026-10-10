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
  "delegation-reconnect",
  "delegation-restart",
  "provider-failure",
  "ui-create",
  "conversation-isolation",
  "history",
  "mcp-http",
  "mcp-stdio",
] as const;
export const hostCases = ["host-isolation", "host-reconnect", "host-revoke"] as const;
export const liveCases = [
  "live-codex",
  "live-claude",
  "live-opencode",
  "live-grok",
  "live-gemini",
  "live-mcp-codex",
  "live-mcp-claude",
  "live-mcp-opencode",
  "live-mcp-grok",
  "live-mcp-gemini",
  "live-group",
  "live-switch",
] as const;

export function releaseCoverage(
  results: readonly { id: string; mode: string; status: string }[],
  elapsedMs: number,
  suite: "release" | "scripted" = "release",
) {
  const missing = ["local", "host"].flatMap((mode) =>
    [...scriptedCases, ...(suite === "release" ? liveCases : []), ...(mode === "host" ? hostCases : [])]
      .filter((id) => !results.some((entry) => entry.mode === mode && entry.id === id && entry.status === "passed"))
      .map((id) => `${mode}/${id}`),
  );
  return {
    missing,
    passed: missing.length === 0 && elapsedMs <= 600_000 && results.every((entry) => entry.status === "passed"),
  };
}

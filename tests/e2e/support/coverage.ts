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
  "delegation-restart",
  "provider-failure",
  "ui-create",
  "conversation-isolation",
  "history",
  "mcp-http",
  "mcp-stdio",
] as const;
// A local reconnect only reloads the page, so reconnect cases run only in host mode.
export const hostCases = [
  "host-isolation",
  "host-reconnect",
  "host-revoke",
  "reconnect",
  "delegation-reconnect",
] as const;
export const liveCases = [
  "live-codex",
  "live-claude",
  "live-opencode",
  "live-grok",
  "live-gemini",
  "live-group",
  "live-switch",
] as const;
// Host mode repeats the scripted host MCP coverage, so real-provider MCP cases run only locally.
export const localLiveCases = [
  "live-mcp-codex",
  "live-mcp-claude",
  "live-mcp-opencode",
  "live-mcp-grok",
  "live-mcp-gemini",
] as const;
export const releaseBudgetMs = 600_000;

export function requiredCases(mode: "local" | "host", suite: "release" | "scripted"): string[] {
  return [
    ...scriptedCases,
    ...(mode === "host" ? hostCases : []),
    ...(suite === "release" ? [...liveCases, ...(mode === "local" ? localLiveCases : [])] : []),
  ];
}

/** `budgetMs` is null outside CI: a local run on one worker cannot meet the parallel budget. */
export function releaseCoverage(
  results: readonly { id: string; mode: string; status: string }[],
  elapsedMs: number,
  suite: "release" | "scripted" = "release",
  budgetMs: number | null = releaseBudgetMs,
) {
  const missing = (["local", "host"] as const).flatMap((mode) =>
    requiredCases(mode, suite)
      .filter((id) => !results.some((entry) => entry.mode === mode && entry.id === id && entry.status === "passed"))
      .map((id) => `${mode}/${id}`),
  );
  return {
    missing,
    passed:
      missing.length === 0 &&
      (budgetMs === null || elapsedMs <= budgetMs) &&
      results.every((entry) => entry.status === "passed"),
  };
}

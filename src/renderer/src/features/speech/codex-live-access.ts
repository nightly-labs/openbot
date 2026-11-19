import type { AgentProviderStatus } from "@openbot/contracts/ipc";

export type CodexLiveAccess = "ready" | "signIn";

export function codexLiveAccess(providers: readonly AgentProviderStatus[] | undefined): CodexLiveAccess | undefined {
  const codex = providers?.find((provider) => provider.id === "codex");
  if (!codex || codex.connectionState === "connecting") return undefined;
  if (codex.state === "sign-in-required" || codex.state === "not-installed") return "signIn";
  if (codex.state === "available") return codex.apiKeyInUse ? "signIn" : "ready";
  return undefined;
}

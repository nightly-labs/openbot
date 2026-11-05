import type { AgentProviderStatus } from "@openbot/contracts/ipc";

/**
 * Whether Codex on this computer can open live voice: `ready` with a ChatGPT sign-in, `signIn` with
 * an API key, no sign-in, or no Codex. Undefined while it is not known.
 */
export type CodexLiveAccess = "ready" | "signIn";

/**
 * Only a known answer counts. A Codex that is stopped, starts, or checks itself again can still open
 * live voice: live voice starts it.
 */
export function codexLiveAccess(providers: readonly AgentProviderStatus[] | undefined): CodexLiveAccess | undefined {
  const codex = providers?.find((provider) => provider.id === "codex");
  if (!codex || codex.connectionState === "connecting") return undefined;
  if (codex.state === "sign-in-required" || codex.state === "not-installed") return "signIn";
  if (codex.state === "available") return codex.apiKeyInUse ? "signIn" : "ready";
  return undefined;
}

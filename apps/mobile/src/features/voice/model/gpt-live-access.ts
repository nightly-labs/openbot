import { type AgentProviderStatus, DEFAULT_PROVIDER_ACCOUNT_ID } from "@openbot/contracts/ipc";

export type GptLiveAccess = "ready" | "signIn";

export function gptLiveAccess(providers: readonly AgentProviderStatus[] | undefined): GptLiveAccess | undefined {
  const codex = providers?.find((provider) => provider.id === "codex");
  if (!codex || codex.connectionState === "connecting") return undefined;
  if (codex.state === "sign-in-required" || codex.state === "not-installed") return "signIn";
  if (codex.state === "available") return codex.apiKeyInUse && !hasPlanAccount(codex) ? "signIn" : "ready";
  return undefined;
}

function hasPlanAccount(codex: AgentProviderStatus): boolean {
  return (
    codex.accounts?.some((account) => account.id !== DEFAULT_PROVIDER_ACCOUNT_ID && account.state === "connected") ??
    false
  );
}

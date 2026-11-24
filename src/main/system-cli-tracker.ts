import { isManagedRuntimeProvider, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { AgentProviderStatus, AgentStatus } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { CodexCliError, resolveClaudeCli, resolveCodexCli } from "../backend/cli";
import type { ProviderRuntimeManager } from "./provider-runtime-manager";
import type { ProviderUseSettingsStore } from "./provider-use-settings-store";

export interface SystemCliTrackerDependencies {
  runtimes: Pick<
    ProviderRuntimeManager,
    "setSystemVersion" | "getStatus" | "download" | "providerUseChanged" | "executablePath"
  >;
  providerUse: Pick<ProviderUseSettingsStore, "off" | "installed">;
  agentProviders: () => ReadonlySet<string>;
  hosted: boolean;
  server: boolean;
}

export function createSystemCliTracker({
  runtimes,
  providerUse,
  agentProviders,
  hosted,
  server,
}: SystemCliTrackerDependencies): (status: Pick<AgentStatus, "providers">) => void {
  const started = new Set<ManagedProviderId>();
  const resolvesAsMissing = (provider: "claude" | "codex") =>
    (provider === "claude" ? resolveClaudeCli : resolveCodexCli)({
      bundledExecutable: runtimes.executablePath(provider),
    }).pipe(
      Effect.as(false),
      Effect.catch((failure) =>
        Effect.succeed(failure.cause instanceof CodexCliError && failure.cause.code === "missing"),
      ),
    );
  const hostedCliDownload = (provider: AgentProviderStatus, used: ReadonlySet<string>) => {
    if (provider.state === "outdated") return Effect.succeed(true);
    if (!used.has(provider.id) || provider.cliSource !== undefined || provider.version !== null) return null;
    if (provider.state === "not-installed") return Effect.succeed(true);
    if (provider.state === "error" && (provider.id === "claude" || provider.id === "codex"))
      return resolvesAsMissing(provider.id);
    return null;
  };
  const replacesIncompleteCli = (
    provider: AgentProviderStatus,
    runtime: ManagedProviderId,
    used: ReadonlySet<string>,
  ) =>
    provider.cliIncomplete === true &&
    used.has(runtime) &&
    !providerUse.installed().includes(runtime) &&
    runtimes.getStatus().providers[runtime].phase === "not-downloaded";
  const serverCliDownload = (provider: AgentProviderStatus, runtime: ManagedProviderId, used: ReadonlySet<string>) => {
    if (replacesIncompleteCli(provider, runtime, used)) return Effect.succeed(true);
    return hosted ? hostedCliDownload(provider, used) : null;
  };
  return (status) => {
    let copyInUse = false;
    const used = server ? agentProviders() : null;
    for (const provider of status.providers ?? []) {
      if (!isManagedRuntimeProvider(provider.id)) continue;
      const version = provider.cliSource === "system" ? (provider.version ?? null) : null;
      if (runtimes.setSystemVersion(provider.id, version, provider.cliIncomplete === true)) copyInUse = true;
      const needsDownload = used === null ? null : serverCliDownload(provider, provider.id, used);
      if (needsDownload !== null && !started.has(provider.id) && !providerUse.off().includes(provider.id)) {
        started.add(provider.id);
        const runtime = provider.id;
        Effect.runFork(
          needsDownload.pipe(
            Effect.flatMap((download) => (download ? runtimes.download(runtime) : Effect.void)),
            Effect.ignore,
          ),
        );
      }
    }
    if (copyInUse) Effect.runFork(runtimes.providerUseChanged());
  };
}

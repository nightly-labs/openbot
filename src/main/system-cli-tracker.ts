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
  const hostedStarted = new Set<ManagedProviderId>();
  const incompleteStarted = new Set<ManagedProviderId>();
  const replacesIncompleteCli = (
    provider: AgentProviderStatus,
    runtime: ManagedProviderId,
    used: () => ReadonlySet<string>,
  ) =>
    provider.cliIncomplete === true &&
    !incompleteStarted.has(runtime) &&
    !providerUse.installed().includes(runtime) &&
    runtimes.getStatus().providers[runtime].phase === "not-downloaded" &&
    used().has(runtime);
  const startDownload = (runtime: ManagedProviderId, needsDownload: Effect.Effect<boolean>) => {
    Effect.runFork(
      needsDownload.pipe(
        Effect.flatMap((download) => (download ? runtimes.download(runtime) : Effect.void)),
        Effect.ignore,
      ),
    );
  };
  return (status) => {
    let copyInUse = false;
    let usedProviders: ReadonlySet<string> | null = null;
    const used = () => {
      usedProviders ??= agentProviders();
      return usedProviders;
    };
    for (const provider of status.providers ?? []) {
      if (!isManagedRuntimeProvider(provider.id)) continue;
      const runtime = provider.id;
      const version = provider.cliSource === "system" ? (provider.version ?? null) : null;
      if (runtimes.setSystemVersion(runtime, version, provider.cliIncomplete === true)) copyInUse = true;
      if (!server || providerUse.off().includes(runtime)) continue;
      if (replacesIncompleteCli(provider, runtime, used)) {
        incompleteStarted.add(runtime);
        startDownload(runtime, Effect.succeed(true));
        continue;
      }
      if (!hosted || hostedStarted.has(runtime)) continue;
      const needsDownload = hostedCliDownload(provider, used());
      if (needsDownload === null) continue;
      hostedStarted.add(runtime);
      startDownload(runtime, needsDownload);
    }
    if (copyInUse) Effect.runFork(runtimes.providerUseChanged());
  };
}

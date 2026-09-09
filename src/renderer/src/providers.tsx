import type { AgentProviderId, AgentStatus } from "@openbot/contracts/ipc";
import { createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { useAgents } from "./features/agents/agents-context";
import { createProviderRuntimeStore } from "./features/provider-updates/provider-runtime-store";
import { providerSystemCliVersion } from "./features/provider-updates/provider-update";
import { useServers } from "./features/servers/servers-context";
import { createSimpleContext } from "./simple-context";

/**
 * The three coding providers behind an agent - Codex, Claude and Grok - as two
 * separate things the renderer has to reconcile.
 *
 * `providerRuntimes` is the newer, managed path: main downloads a runtime and
 * pushes a revisioned snapshot. `connect*`/`refreshAgentProviders` is the older
 * path, where the provider is already installed and only its sign-in state
 * matters; it reports through `AgentStatus`. Which one a build has is decided by
 * `window.openbot.providerRuntimes` being present at all, which is why every
 * consumer picks its handlers through `providerRuntimeDownloadsAvailable()`.
 *
 * Ungated - `FALLBACK_PROVIDER_RUNTIMES` is a usable snapshot, and the agent
 * status this reads through `useAgents()` has its own fallback.
 *
 * Nested under `agents` because both paths end in an `AgentStatus`:
 * `applyAgentStatus` lives here rather than there because the only thing it does
 * beyond storing the status is close out the connect attempts this domain
 * started. Depending outward on `agents` keeps that edge one-way.
 */
const Providers = createSimpleContext({
  name: "Providers",
  init: () => {
    const { agentStatus, setAgentStatus } = useAgents();
    const { activeServer } = useServers();
    const [refreshingProviders, setRefreshingProviders] = createSignal(false);
    /**
     * A CLI the user installed themselves, and the version it reports. Only the agent status knows
     * this, and the runtime store needs it to run the right updater for that install - and to keep
     * OpenBot's pinned version away from it.
     */
    function systemCliVersion(provider: AgentProviderId): string | null | undefined {
      return providerSystemCliVersion(agentStatus().providers?.find((candidate) => candidate.id === provider));
    }
    const runtimes = createProviderRuntimeStore(window.openbot.providerRuntimes, {
      systemCliVersion,
      updateSystemCli: (provider) => updateProviderCli(provider),
      isLocalServer: () => activeServer()?.kind === "local",
    });
    /** Connect attempts still waiting for the status that says how they ended. */
    const pendingProviderConnections = new Map<AgentProviderId, ReturnType<typeof desktopAnalytics.scope>>();

    /**
     * The status is the completion signal for every connect started here: main
     * answers `connect()` before the provider has finished coming up, so the
     * outcome arrives later, in a status this or an agent event applies.
     */
    function applyAgentStatus(status: AgentStatus): void {
      for (const provider of status.providers ?? []) {
        const analytics = pendingProviderConnections.get(provider.id);
        if (!analytics) continue;
        if (provider.state === "available") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "succeeded",
          });
        } else if (provider.state === "error") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "failed",
            failure_code: "connect_failed",
          });
        }
      }
      setAgentStatus(status);
    }

    function openProviderInstallGuide(provider: AgentProviderId): Promise<void> {
      if (provider !== "claude")
        return Promise.reject(new Error(`${provider === "codex" ? "ChatGPT" : "Grok"} is included with OpenBot.`));
      return window.openbot.openExternal("claude-install");
    }

    function openProviderSignInGuide(provider: AgentProviderId): Promise<void> {
      if (provider === "claude") return window.openbot.openExternal("claude-sign-in");
      return connectProvider(provider);
    }

    async function connectProvider(provider: AgentProviderId): Promise<void> {
      if (refreshingProviders()) return;
      const analytics = desktopAnalytics.scope();
      pendingProviderConnections.set(provider, analytics);
      analytics.track("provider_action", { provider, action: "connect_started", result: "succeeded" });
      try {
        const status = await window.openbot.connectProvider(provider);
        flush(() => applyAgentStatus(status));
      } catch (error) {
        pendingProviderConnections.delete(provider);
        analytics.track("provider_action", {
          provider,
          action: "connect_completed",
          result: "failed",
          failure_code: "connect_failed",
        });
        throw error;
      }
    }

    /**
     * Runs the provider CLI's own updater, for an install the user made. Nothing is downloaded by
     * OpenBot, so this shares nothing with the managed runtime download in `runtimes`; what comes
     * back is the status the restarted provider reports, with the version it now runs.
     */
    async function updateProviderCli(provider: AgentProviderId): Promise<void> {
      const analytics = desktopAnalytics.scope();
      analytics.track("provider_action", { provider, action: "cli_update_started", result: "succeeded" });
      try {
        const status = await window.openbot.updateProviderCli(provider);
        flush(() => applyAgentStatus(status));
        analytics.track("provider_action", { provider, action: "cli_update_completed", result: "succeeded" });
      } catch (error) {
        analytics.track("provider_action", {
          provider,
          action: "cli_update_completed",
          result: "failed",
          failure_code: "cli_update_failed",
        });
        throw error;
      }
    }

    async function refreshAgentProviders(): Promise<void> {
      if (refreshingProviders() || agentStatus().phase === "starting" || agentStatus().phase === "restarting") {
        return;
      }
      const analytics = desktopAnalytics.scope();
      setRefreshingProviders(true);
      try {
        const status = await window.openbot.refreshAgentProviders();
        flush(() => applyAgentStatus(status));
        analytics.track("provider_action", { action: "refresh", result: "succeeded" });
      } catch (error) {
        analytics.track("provider_action", {
          action: "refresh",
          result: "failed",
          failure_code: "refresh_failed",
        });
        throw error;
      } finally {
        flush(() => setRefreshingProviders(false));
      }
    }

    onSettled(() => {
      return () => {
        pendingProviderConnections.clear();
      };
    });

    return {
      ...runtimes,
      refreshingProviders,
      applyAgentStatus,
      connectProvider,
      openProviderInstallGuide,
      openProviderSignInGuide,
      refreshAgentProviders,
    };
  },
});

export const ProvidersProvider = Providers.provider;
export const useProviders = Providers.use;

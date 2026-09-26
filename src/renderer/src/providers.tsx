import { type AgentProviderId, type AgentStatus, agentProviderDescriptor } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { appPort } from "./app-port";
import { useAgents } from "./features/agents/agents-context";
import { hostCustomProvidersApi } from "./features/custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "./features/custom-providers/stores/custom-providers-store";
import { createProviderCodeLogin } from "./features/provider-updates/provider-code-login";
import { createProviderRuntimeStore } from "./features/provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "./features/provider-updates/remote-provider-runtimes";
import { remoteAdminServer } from "./features/servers/server-capabilities";
import { useServers } from "./features/servers/servers-context";
import { hostProviderKeyApi, providerKeyApi } from "./features/settings/provider-key-api";
import { providersPort } from "./providers-port";
import { createSimpleContext } from "./simple-context";

/**
 * Coding providers (Codex, Claude, Grok) as two paths the renderer reconciles: managed
 * `providerRuntimes` snapshots from main, and the older installed-CLI sign-in state via
 * `AgentStatus`. Consumers pick handlers through `providerRuntimeDownloadsAvailable()`.
 * Nested under `agents` so the edge stays one-way; see docs/ARCHITECTURE.md.
 */
const Providers = createSimpleContext({
  name: "Providers",
  init: () => {
    const { agentStatus, setAgentStatus } = useAgents();
    const { activeServer } = useServers();
    const [refreshingProviders, setRefreshingProviders] = createSignal(false);
    /**
     * A CLI the user installed themselves, and the version it reports. Only the agent status knows
     * this, and the runtime store needs it to offer that install the same update a managed runtime
     * gets. Updates install the managed copy without changing the system installation.
     */
    function systemCliVersion(provider: AgentProviderId): string | null {
      const row = agentStatus().providers?.find((candidate) => candidate.id === provider);
      return row?.cliSource === "system" ? (row.version ?? null) : null;
    }
    /**
     * The joined server whose host this window manages, when the account administers it and the host
     * serves `providers-v1`. A memo, not a value: the host's capabilities arrive after this mounts.
     */
    const providerAdminServerId = createMemo(() => remoteAdminServer(activeServer(), "providers-v1")?.id);
    const providerAdmin = () => providersPort().providerAdmin;
    const runtimes = createProviderRuntimeStore(
      createMemo(() => {
        const serverId = providerAdminServerId();
        return serverId ? remoteProviderRuntimes(providerAdmin, serverId) : providersPort().providerRuntimes;
      }),
      {
        systemCliVersion,
        isLocalServer: () => activeServer()?.kind === "local",
        managesRuntimes: () => activeServer()?.kind === "local" || providerAdminServerId() !== undefined,
      },
    );
    /** The provider keys of the computer the providers run on. */
    const providerKeys = createMemo(() => {
      const serverId = providerAdminServerId();
      return serverId ? hostProviderKeyApi(providerAdmin, serverId) : providerKeyApi;
    });
    /**
     * The host's own endpoints, for Settings. The machine-local list in `CustomProvidersProvider`
     * stays what the model picker reads.
     */
    const hostCustomProviders = createCustomProvidersStore(() => {
      const serverId = providerAdminServerId();
      return serverId ? hostCustomProvidersApi(providerAdmin, serverId) : undefined;
    });
    createEffect(providerAdminServerId, (serverId) => {
      // As for this computer's list: a failure leaves it empty, and nothing retries it from here.
      if (serverId) void hostCustomProviders.refreshCustomProviders().catch(() => undefined);
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
      const descriptor = agentProviderDescriptor(provider);
      if (descriptor.installGuideLink === null) {
        return Promise.reject(new Error(`${descriptor.displayName} is included with OpenBot.`));
      }
      return appPort().openExternal(descriptor.installGuideLink);
    }

    /**
     * Signs the user in to one provider, through that provider's own login: Codex opens a browser,
     * Claude and Grok run their CLI's OAuth command, and OpenCode is asked again. Every sign-in
     * entry point calls this - the composer notice, the model picker, onboarding and settings - so
     * none of them leaves the user to read a documentation page and sign in in a terminal.
     */
    async function connectProvider(provider: AgentProviderId): Promise<void> {
      if (refreshingProviders()) return;
      const analytics = beginProviderConnection(provider);
      try {
        const status = await providersPort().connectProvider(provider);
        flush(() => applyAgentStatus(status));
      } catch (error) {
        endFailedProviderConnection(provider, analytics);
        throw error;
      }
    }

    /** Opens a connect attempt: the status that ends it is matched back to this scope by provider. */
    function beginProviderConnection(provider: AgentProviderId) {
      const analytics = desktopAnalytics.scope();
      pendingProviderConnections.set(provider, analytics);
      analytics.track("provider_action", { provider, action: "connect_started", result: "succeeded" });
      return analytics;
    }

    function endFailedProviderConnection(
      provider: AgentProviderId,
      analytics: ReturnType<typeof desktopAnalytics.scope>,
    ): void {
      pendingProviderConnections.delete(provider);
      analytics.track("provider_action", {
        provider,
        action: "connect_completed",
        result: "failed",
        failure_code: "connect_failed",
      });
    }

    async function refreshAgentProviders(): Promise<void> {
      if (refreshingProviders() || agentStatus().phase === "starting" || agentStatus().phase === "restarting") {
        return;
      }
      const analytics = desktopAnalytics.scope();
      setRefreshingProviders(true);
      try {
        const status = await providersPort().refreshAgentProviders();
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

    /**
     * The code sign-in as the one object its surfaces take. Onboarding and Settings both offer it
     * and would otherwise each assemble the same six pieces.
     */
    const codeLogin = createProviderCodeLogin({
      agentStatus,
      applyStatus: applyAgentStatus,
      target: () => {
        const serverId = providerAdminServerId();
        return serverId
          ? {
              start: (provider) => providerAdmin().startCodeLogin(provider, serverId),
              cancel: (provider) => providerAdmin().cancelCodeLogin(provider, serverId),
            }
          : {
              start: (provider) => providersPort().startProviderCodeLogin(provider),
              cancel: (provider) => providersPort().cancelProviderCodeLogin(provider),
            };
      },
      openVerificationUrl: (url) => void appPort().openUrl(url),
      connection: {
        begin: (provider) => {
          const analytics = beginProviderConnection(provider);
          return () => endFailedProviderConnection(provider, analytics);
        },
        drop: (provider) => pendingProviderConnections.delete(provider),
      },
    });

    return {
      ...runtimes,
      providerAdminServerId,
      providerKeys,
      hostCustomProviders,
      refreshingProviders,
      applyAgentStatus,
      connectProvider,
      codeLogin,
      openProviderInstallGuide,
      refreshAgentProviders,
    };
  },
});

export const ProvidersProvider = Providers.provider;
export const useProviders = Providers.use;

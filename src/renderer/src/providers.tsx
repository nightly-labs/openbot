import {
  type AgentProviderId,
  type AgentStatus,
  agentProviderDescriptor,
  isManagedRuntimeProvider,
  LOCAL_SERVER_ID,
  type ProviderRuntimeDownload,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import {
  type ProviderAccountRelay,
  providerAccountRelay,
} from "@openbot/contracts/team-protocol/provider-account-relays";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDER_SIGN_OUT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import type { ProviderAccountActions } from "@openbot/ui/components/provider-accounts";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onSettled } from "solid-js";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "./analytics";
import { appPort } from "./app-port";
import { useAgents } from "./features/agents/agents-context";
import { conversationPort } from "./features/conversation/conversation-port";
import { hostCustomProvidersApi } from "./features/custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "./features/custom-providers/stores/custom-providers-store";
import { createProviderConnection } from "./features/provider-updates/provider-connection";
import { createProviderRuntimeStore } from "./features/provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "./features/provider-updates/remote-provider-runtimes";
import { remoteAdminServer, serverSupportsCapability } from "./features/servers/server-capabilities";
import { useServers } from "./features/servers/servers-context";
import { hostProviderKeyApi, providerKeyApi } from "./features/settings/provider-key-api";
import { usePlatform } from "./platform";
import { providersPort } from "./providers-port";
import { createSimpleContext } from "./simple-context";

type ProviderConnectMethod = Extract<DesktopAnalyticsProperties<"provider_action">["method"], "browser" | "code">;

/**
 * Coding providers (Codex, Claude, Grok) as two paths the renderer reconciles: managed
 * `providerRuntimes` snapshots from main, and the older installed-CLI sign-in state via
 * `AgentStatus`. Consumers pick handlers through `providerRuntimeDownloadsAvailable()`.
 * Nested under `agents` so the edge stays one-way; see docs/architecture/change-rules.md.
 */
const Providers = createSimpleContext({
  name: "Providers",
  init: () => {
    const { agentStatus, setAgentStatus, refreshHostAccounts, refreshHostAccountUsage } = useAgents();
    const { activeServer } = useServers();
    const { appInfo } = usePlatform();
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
    // A boolean, so that a server-list update that keeps the capability does not rebuild the keys.
    const hostReadsClaudeKey = createMemo(() => serverSupportsCapability(activeServer(), CLAUDE_API_KEY_CAPABILITY));
    /** The provider keys of the computer the providers run on. A saved key is recorded, never its value. */
    const providerKeys = createMemo(() => {
      const serverId = providerAdminServerId();
      const api = serverId ? hostProviderKeyApi(providerAdmin, serverId) : providerKeyApi;
      return {
        ...api,
        readsClaudeKey: !serverId || hostReadsClaudeKey(),
        setProviderApiKey: async (input: { provider: AgentProviderId; key: string }) => {
          const analytics = desktopAnalytics.scope();
          const tracked = { provider: input.provider, action: "api_key_saved", method: "api_key" } as const;
          try {
            const result = await api.setProviderApiKey(input);
            analytics.track("provider_action", { ...tracked, result: "succeeded" });
            return result;
          } catch (error) {
            analytics.track("provider_action", { ...tracked, result: "failed", failure_code: "update_failed" });
            throw error;
          }
        },
      };
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
    const pendingProviderConnections = new Map<
      AgentProviderId,
      { analytics: ReturnType<typeof desktopAnalytics.scope>; method: ProviderConnectMethod }
    >();
    /**
     * The status is the completion signal for every connect started here: main
     * answers `connect()` before the provider has finished coming up, so the
     * outcome arrives later, in a status this or an agent event applies.
     */
    function applyAgentStatus(status: AgentStatus): void {
      for (const provider of status.providers ?? []) {
        const { analytics, method } = pendingProviderConnections.get(provider.id) ?? {};
        if (!analytics) continue;
        if (provider.state === "available") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "succeeded",
            ...(method ? { method } : {}),
          });
        } else if (provider.state === "error") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "failed",
            failure_code: "connect_failed",
            ...(method ? { method } : {}),
          });
        }
      }
      setAgentStatus(status);
    }

    function openProviderInstallGuide(provider: AgentProviderId): Promise<void> {
      const descriptor = agentProviderDescriptor(provider);
      if (descriptor.installGuideLink === null) {
        return Promise.reject(new Error(currentText().t("app.provider.included", { name: descriptor.displayName })));
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
      const analytics = beginProviderConnection(provider, "browser");
      try {
        const status = await providersPort().connectProvider(provider);
        flush(() => applyAgentStatus(status));
      } catch (error) {
        endFailedProviderConnection(provider, analytics, "browser");
        throw error;
      }
    }

    /** Ends a browser sign-in that Connect started. The provider then shows its state from before. */
    async function cancelProviderSignIn(provider: AgentProviderId): Promise<void> {
      dropProviderConnection(provider);
      const status = await providersPort().cancelProviderSignIn(provider);
      flush(() => applyAgentStatus(status));
    }

    /** Opens a connect attempt: the status that ends it is matched back to this scope by provider. */
    function beginProviderConnection(provider: AgentProviderId, method: ProviderConnectMethod) {
      const analytics = desktopAnalytics.scope();
      pendingProviderConnections.set(provider, { analytics, method });
      analytics.track("provider_action", {
        provider,
        action: "connect_started",
        result: "succeeded",
        method,
      });
      return analytics;
    }

    /** The user ended a sign-in that is still waiting. Its status then says nothing about the connect. */
    function dropProviderConnection(provider: AgentProviderId): void {
      const pending = pendingProviderConnections.get(provider);
      if (!pending) return;
      pendingProviderConnections.delete(provider);
      pending.analytics.track("provider_action", {
        provider,
        action: "sign_in_cancelled",
        result: "cancelled",
        method: pending.method,
      });
    }

    function endFailedProviderConnection(
      provider: AgentProviderId,
      analytics: ReturnType<typeof desktopAnalytics.scope>,
      method: ProviderConnectMethod,
    ): void {
      pendingProviderConnections.delete(provider);
      analytics.track("provider_action", {
        provider,
        action: "connect_completed",
        result: "failed",
        failure_code: "connect_failed",
        method,
      });
    }

    /** `automatic`: the app asks, not the user, so a provider OpenBot stopped starting stays stopped. */
    async function refreshAgentProviders(options = { automatic: false }): Promise<void> {
      if (refreshingProviders() || agentStatus().phase === "starting" || agentStatus().phase === "restarting") {
        return;
      }
      const analytics = desktopAnalytics.scope();
      setRefreshingProviders(true);
      try {
        const status = await providersPort().refreshAgentProviders(options);
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

    /**
     * Restarts a provider of this computer after its turns end. A joined host has no such action:
     * its provider API has no restart, so the caller offers none there.
     */
    async function setProviderOn(provider: AgentProviderId, on: boolean): Promise<void> {
      const server = activeServer();
      if (server?.kind !== "local") return;
      const status = await providersPort().setProviderOn({ provider, on });
      if (activeServer()?.id === server.id) flush(() => applyAgentStatus(status));
    }

    /**
     * The downloaded CLI of a provider of this computer that is off. A joined host has no such call,
     * so its providers offer no removal.
     */
    async function measureProviderDownload(provider: AgentProviderId): Promise<ProviderRuntimeDownload> {
      if (activeServer()?.kind !== "local" || !isManagedRuntimeProvider(provider)) return { bytes: 0, versions: 0 };
      return await providersPort().providerRuntimes.measureDownload(provider);
    }

    /** Removes the downloaded CLI of a provider of this computer that is off. */
    async function removeProviderDownload(provider: AgentProviderId): Promise<void> {
      const server = activeServer();
      if (server?.kind !== "local" || !isManagedRuntimeProvider(provider)) return;
      const snapshot = await providersPort().providerRuntimes.removeDownload(provider);
      if (activeServer()?.id === server.id) flush(() => runtimes.applyProviderRuntimeSnapshot(snapshot));
    }

    /** The joined server whose host's provider accounts this window manages (`provider-accounts-v1`). */
    const accountsAdminServerId = createMemo(() => remoteAdminServer(activeServer(), PROVIDER_ACCOUNTS_CAPABILITY)?.id);
    /** The joined server whose host spends the usage reset credits of its accounts (`provider-usage-reset-v1`). */
    const usageResetServerId = createMemo(() => remoteAdminServer(activeServer(), PROVIDER_USAGE_RESET_CAPABILITY)?.id);
    /** The joined server whose host signs its own provider sign-ins out (`provider-sign-out-v1`). */
    const signOutServerId = createMemo(() => remoteAdminServer(activeServer(), PROVIDER_SIGN_OUT_CAPABILITY)?.id);

    /**
     * The accounts of the providers of this computer, or of a joined server's host that serves
     * `provider-accounts-v1`. An older host and a member get none.
     */
    const providerAccounts = createMemo<ProviderAccountActions | undefined>(() => {
      const hostServerId = accountsAdminServerId();
      if (hostServerId) {
        const changed = async (request: Promise<void>) => {
          await request;
          await refreshHostAccounts();
        };
        return {
          connect: async (provider, accountId) => connection.connectAccount(provider, accountId),
          // The host runs one account sign-in for each provider, so the released cancel names only the provider.
          cancel: async (provider) => {
            await accountSignIn(hostServerId).cancel(provider);
          },
          rename: (provider, accountId, label) =>
            changed(providerAdmin().renameAccount({ provider, accountId, label }, hostServerId)),
          remove: (provider, accountId) =>
            changed(providerAdmin().removeAccount({ provider, accountId }, hostServerId)),
          ...(usageResetServerId() === hostServerId
            ? {
                usageResets: (provider: AgentProviderId) => providerAdmin().usageResets(provider, hostServerId),
                resetUsage: async (provider: AgentProviderId, accountId: string) => {
                  const outcome = await providerAdmin().resetUsage({ provider, accountId }, hostServerId);
                  // The host sends the reading of its own sign-in; the accounts after the first are read here.
                  await refreshHostAccountUsage().catch(() => undefined);
                  return outcome;
                },
              }
            : {}),
          ...(signOutServerId() === hostServerId
            ? { signOut: (provider: AgentProviderId) => changed(providerAdmin().signOut(provider, hostServerId)) }
            : {}),
        };
      }
      if (activeServer()?.kind !== "local") return undefined;
      const apply = async (request: Promise<AgentStatus>) => {
        const serverId = activeServer()?.id;
        const status = await request;
        if (activeServer()?.id === serverId) flush(() => applyAgentStatus(status));
      };
      // A sign-in ends after its answer, and the status has no order, so an older answer could hide how it
      // ended. The `status` events carry the account's state.
      return {
        connect: async (provider, accountId) => {
          await providersPort().connectProviderAccount({ provider, accountId });
        },
        cancel: async (provider, accountId) => {
          await providersPort().cancelProviderAccountSignIn({ provider, accountId });
        },
        rename: (provider, accountId, label) =>
          apply(providersPort().renameProviderAccount({ provider, accountId, label })),
        remove: (provider, accountId) => apply(providersPort().removeProviderAccount({ provider, accountId })),
        usageResets: (provider) => providersPort().providerUsageResets(provider),
        resetUsage: (provider, accountId) => providersPort().resetProviderUsage({ provider, accountId }),
        signOut: (provider) => apply(providersPort().signOutProvider(provider)),
        local: true,
      };
    });

    async function restartProvider(provider: AgentProviderId): Promise<void> {
      await changeProviderRestart(provider, providersPort().restartProvider);
    }

    async function cancelProviderRestart(provider: AgentProviderId): Promise<void> {
      await changeProviderRestart(provider, providersPort().cancelProviderRestart);
    }

    /** A failed restart is also on the provider's status; this reports a request that main refused. */
    async function changeProviderRestart(
      provider: AgentProviderId,
      request: (provider: AgentProviderId) => Promise<AgentStatus>,
    ): Promise<void> {
      try {
        const status = await request(provider);
        flush(() => applyAgentStatus(status));
      } catch (error) {
        const { t, errorMessage } = currentText();
        const title = t("app.provider.restartFailed", { name: agentProviderDescriptor(provider).displayName });
        toast.error(title, {
          ...{ description: errorMessage(error, title) },
          report: { operation: "provider", source: "system", cause_code: classifyFailure(error) },
        });
      }
    }

    onSettled(() => {
      return () => {
        pendingProviderConnections.clear();
      };
    });

    /**
     * An account sign-in on the host's page. The released status does not carry the accounts, so the
     * accounts are read again when the sign-in ends.
     */
    function accountSignIn(serverId: string) {
      return {
        hostName: activeServer()?.name ?? "",
        runtime: conversationPort().browser,
        clipboard: serverSupportsCapability(activeServer(), "browser-view-clipboard"),
        start: (provider: AgentProviderId, accountId: string | null) =>
          providerAdmin().startAccountSignIn({ provider, accountId }, serverId),
        status: async (provider: AgentProviderId) => {
          const status = await providerAdmin().accountSignInStatus(provider, serverId);
          if (status.result) await refreshHostAccounts().catch(() => undefined);
          return status;
        },
        cancel: async (provider: AgentProviderId) => {
          await providerAdmin().cancelAccountSignIn(provider, serverId);
          await refreshHostAccounts().catch(() => undefined);
          return agentStatus();
        },
      };
    }

    /**
     * An account sign-in that the host relays to this computer's browser (`provider-account-relay-v1`
     * or `-v2`). The other relay requests run it by its provider, and the accounts are read again when
     * it ends.
     */
    function accountRelay(serverId: string, relayed: ProviderAccountRelay) {
      return {
        providers: relayed.providers,
        hostName: activeServer()?.name ?? "",
        start: (provider: AgentProviderId, accountId: string | null) =>
          providerAdmin().startAccountRelaySignIn({ provider, accountId }, serverId),
        status: async (provider: AgentProviderId) => {
          const status = await providerAdmin().relaySignInStatus(provider, serverId);
          if (status.result) await refreshHostAccounts().catch(() => undefined);
          return status;
        },
        open: (provider: AgentProviderId) => providerAdmin().openRelaySignIn(provider, serverId),
        paste: (provider: AgentProviderId, address: string) =>
          providerAdmin().pasteRelaySignIn({ provider, address }, serverId),
        cancel: async (provider: AgentProviderId) => {
          const status = await providerAdmin().cancelRelaySignIn(provider, serverId);
          await refreshHostAccounts().catch(() => undefined);
          return status;
        },
      };
    }

    /**
     * The provider sign-in as the one object its surfaces take. Onboarding, Settings, the composer
     * and the model picker all offer it, so each offers the same ways in.
     */
    const connection = createProviderConnection({
      agentStatus,
      applyStatus: applyAgentStatus,
      target: () => {
        const serverId = providerAdminServerId();
        const relayed =
          serverId && accountsAdminServerId() === serverId
            ? providerAccountRelay((capability) => serverSupportsCapability(activeServer(), capability))
            : null;
        return serverId
          ? {
              start: (provider) => providerAdmin().startCodeLogin(provider, serverId),
              submit: (provider, code) => providerAdmin().submitCodeLogin({ provider, code }, serverId),
              cancel: (provider) => providerAdmin().cancelCodeLogin(provider, serverId),
              hostSignIn: {
                hostName: activeServer()?.name ?? "",
                runtime: conversationPort().browser,
                clipboard: serverSupportsCapability(activeServer(), "browser-view-clipboard"),
                start: (provider) => providerAdmin().startHostSignIn(provider, serverId),
                status: (provider) => providerAdmin().hostSignInStatus(provider, serverId),
                cancel: (provider) => providerAdmin().cancelHostSignIn(provider, serverId),
              },
              ...(accountsAdminServerId() === serverId ? { accountSignIn: accountSignIn(serverId) } : {}),
              ...(relayed ? { accountRelay: accountRelay(serverId, relayed) } : {}),
              relay: {
                hostName: activeServer()?.name ?? "",
                start: (provider) => providerAdmin().startRelaySignIn(provider, serverId),
                status: (provider) => providerAdmin().relaySignInStatus(provider, serverId),
                open: (provider) => providerAdmin().openRelaySignIn(provider, serverId),
                paste: (provider, address) => providerAdmin().pasteRelaySignIn({ provider, address }, serverId),
                cancel: (provider) => providerAdmin().cancelRelaySignIn(provider, serverId),
              },
            }
          : {
              start: (provider) => providersPort().startProviderCodeLogin(provider),
              submit: (provider, code) => providerAdmin().submitCodeLogin({ provider, code }, LOCAL_SERVER_ID),
              cancel: (provider) => providersPort().cancelProviderCodeLogin(provider),
            };
      },
      // A member of a joined server cannot connect its providers. This computer's own are connected here.
      place: () =>
        providerAdminServerId()
          ? { kind: "app-server", server: activeServer() }
          : activeServer()?.kind === "remote"
            ? null
            : { kind: "computer", platform: appInfo()?.platform },
      connectInBrowser: connectProvider,
      openVerificationUrl: (url) => void appPort().openUrl(url),
      analytics: {
        begin: (provider) => {
          const analytics = beginProviderConnection(provider, "code");
          return () => endFailedProviderConnection(provider, analytics, "code");
        },
        drop: dropProviderConnection,
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
      cancelProviderSignIn,
      connection,
      openProviderInstallGuide,
      refreshAgentProviders,
      setProviderOn,
      measureProviderDownload,
      removeProviderDownload,
      providerAccounts,
      restartProvider,
      cancelProviderRestart,
    };
  },
});

export const ProvidersProvider = Providers.provider;
export const useProviders = Providers.use;

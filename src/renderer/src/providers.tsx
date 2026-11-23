import {
  isKeyOnlyProvider,
  type ManagedProviderId,
  pasteCodeSignInSupported,
} from "@openbot/contracts/agent-providers";
import {
  type AgentProviderId,
  type AgentStatus,
  agentProviderDescriptor,
  type CustomProviderSummary,
  isManagedRuntimeProvider,
  LOCAL_SERVER_ID,
  type ProviderRuntimeDownload,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { CODEX_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/codex-api-key-v1";
import { CUSTOM_PROVIDER_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/custom-provider-edit-v1";
import { LIVE_VOICE_ACCOUNT_CAPABILITY } from "@openbot/contracts/team-protocol/live-voice-account-v1";
import { PROVIDER_ACCOUNT_CODE_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-code-v1";
import { PROVIDER_ACCOUNT_KEYS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-keys-v1";
import { PROVIDER_ACCOUNT_POOL_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import {
  type ProviderAccountRelay,
  providerAccountRelay,
} from "@openbot/contracts/team-protocol/provider-account-relays";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  PROVIDER_FROZEN_ACCOUNTS_LIMIT,
  PROVIDER_MANY_ACCOUNTS_CAPABILITY,
  PROVIDER_MANY_ACCOUNTS_LIMIT,
} from "@openbot/contracts/team-protocol/provider-many-accounts-v1";
import { PROVIDER_SIGN_OUT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDER_USE_CAPABILITY } from "@openbot/contracts/team-protocol/provider-use-v1";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import type { ProviderAccountActions } from "@openbot/ui/components/provider-accounts";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onSettled, untrack } from "solid-js";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "./analytics";
import { appPort } from "./app-port";
import { useAgents } from "./features/agents/agents-context";
import { conversationPort } from "./features/conversation/conversation-port";
import { hostCustomAgentsApi } from "./features/custom-agents/custom-agents-port";
import { createCustomAgentsStore } from "./features/custom-agents/stores/custom-agents-store";
import { useCustomProviders } from "./features/custom-providers/custom-providers-context";
import { hostCustomProvidersApi } from "./features/custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "./features/custom-providers/stores/custom-providers-store";
import { createProviderConnection } from "./features/provider-updates/provider-connection";
import { createProviderRuntimeStore, hostConnection } from "./features/provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "./features/provider-updates/remote-provider-runtimes";
import { remoteAdminServer, serverSupportsCapability } from "./features/servers/server-capabilities";
import { useServers } from "./features/servers/servers-context";
import { hostProviderKeyApi, providerKeyApi } from "./features/settings/provider-key-api";
import { usePlatform } from "./platform";
import { providersPort } from "./providers-port";
import { createSimpleContext } from "./simple-context";

type ProviderConnectMethod = Extract<DesktopAnalyticsProperties<"provider_action">["method"], "browser" | "code">;

const Providers = createSimpleContext({
  name: "Providers",
  init: () => {
    const { agentStatus, setAgentStatus, refreshHostAccounts, refreshHostAccountUsage } = useAgents();
    const { activeServer } = useServers();
    const { appInfo } = usePlatform();
    const [refreshingProviders, setRefreshingProviders] = createSignal(false);
    function systemCliVersion(provider: AgentProviderId): string | null {
      const row = agentStatus().providers?.find((candidate) => candidate.id === provider);
      return row?.cliSource === "system" && !row.cliIncomplete ? (row.version ?? null) : null;
    }
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
        hostConnection: () => hostConnection(activeServer()),
      },
    );
    const hostReadsClaudeKey = createMemo(() => serverSupportsCapability(activeServer(), CLAUDE_API_KEY_CAPABILITY));
    const hostReadsCodexKey = createMemo(() => serverSupportsCapability(activeServer(), CODEX_API_KEY_CAPABILITY));
    const providerKeys = createMemo(() => {
      const serverId = providerAdminServerId();
      const api = serverId ? hostProviderKeyApi(providerAdmin, serverId) : providerKeyApi;
      return {
        ...api,
        readsClaudeKey: !serverId || hostReadsClaudeKey(),
        readsCodexKey: !serverId || hostReadsCodexKey(),
        setProviderApiKey: async (input: { provider: AgentProviderId; key: string }) => {
          const analytics = desktopAnalytics.scope();
          const tracked = { provider: input.provider, action: "api_key_saved", method: "api_key" } as const;
          try {
            const result = await api.setProviderApiKey(input);
            analytics.track("provider_action", { ...tracked, result: "succeeded" });
            if (isKeyOnlyProvider(input.provider)) runtimes.refreshProviderRuntimes();
            return result;
          } catch (error) {
            analytics.track("provider_action", { ...tracked, result: "failed", failure_code: "update_failed" });
            throw error;
          }
        },
      };
    });
    const hostCustomProviders = createCustomProvidersStore(() => {
      const serverId = providerAdminServerId();
      return serverId ? hostCustomProvidersApi(providerAdmin, serverId) : undefined;
    });
    const customAgentsServerId = createMemo(() => remoteAdminServer(activeServer(), "custom-agents-v1")?.id);
    const hostCustomAgents = createCustomAgentsStore(() => {
      const serverId = customAgentsServerId();
      return serverId ? hostCustomAgentsApi(serverId) : undefined;
    });
    createEffect(customAgentsServerId, (serverId) => {
      hostCustomAgents.resetCustomAgents();
      if (serverId) void hostCustomAgents.refreshCustomAgents().catch(() => undefined);
    });
    const localCustomProviders = useCustomProviders();
    function activeCustomProviders(): CustomProviderSummary[] | undefined {
      if (activeServer()?.kind === "local") return localCustomProviders.customProviders();
      if (providerAdminServerId()) return hostCustomProviders.customProviders();
      return undefined;
    }
    const hostEditsCustomProviders = createMemo(() =>
      serverSupportsCapability(activeServer(), CUSTOM_PROVIDER_EDIT_CAPABILITY),
    );
    createEffect(
      () => {
        const serverId = providerAdminServerId();
        return serverId ? `${serverId}:${hostEditsCustomProviders()}` : undefined;
      },
      (key) => {
        if (key) void hostCustomProviders.refreshCustomProviders().catch(() => undefined);
      },
    );
    const pendingProviderConnections = new Map<
      AgentProviderId,
      { analytics: ReturnType<typeof desktopAnalytics.scope>; method: ProviderConnectMethod }
    >();
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

    function connectProvider(provider: AgentProviderId): Promise<void> {
      return startBrowserSignIn(provider, () => providersPort().connectProvider(provider));
    }

    function connectProviderInMainlandChina(provider: AgentProviderId): Promise<void> {
      return startBrowserSignIn(provider, () => providersPort().connectProviderInMainlandChina(provider));
    }

    async function startBrowserSignIn(provider: AgentProviderId, start: () => Promise<AgentStatus>): Promise<void> {
      const analytics = beginProviderConnection(provider, "browser");
      try {
        const status = await start();
        flush(() => applyAgentStatus(status));
      } catch (error) {
        endFailedProviderConnection(provider, analytics, "browser");
        throw error;
      }
    }

    async function cancelProviderSignIn(provider: AgentProviderId): Promise<void> {
      dropProviderConnection(provider);
      const status = await providersPort().cancelProviderSignIn(provider);
      flush(() => applyAgentStatus(status));
    }

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

    const providerUseServerId = createMemo(() => remoteAdminServer(activeServer(), PROVIDER_USE_CAPABILITY)?.id);
    const [hostProviderUse, setHostProviderUse] = createSignal<{ serverId: string; off: AgentProviderId[] }>();
    let providerUseVersion = 0;
    function refreshHostProviderUse(): void {
      const serverId = providerUseServerId();
      if (!serverId) return;
      const version = ++providerUseVersion;
      void providersPort()
        .providerAdmin.providerUse(serverId)
        .then((off) => {
          if (version === providerUseVersion) setHostProviderUse({ serverId, off });
        })
        .catch(() => undefined);
    }
    createEffect(providerUseServerId, () => untrack(refreshHostProviderUse));
    function hostOffProviders(): AgentProviderId[] | undefined {
      const serverId = providerUseServerId();
      const use = hostProviderUse();
      return serverId && use?.serverId === serverId ? use.off : undefined;
    }

    async function setProviderOn(provider: AgentProviderId, on: boolean): Promise<void> {
      const server = activeServer();
      if (server && server.kind !== "local" && server.id === providerUseServerId()) {
        const version = ++providerUseVersion;
        const off = await providersPort().providerAdmin.setProviderUse({ provider, on }, server.id);
        if (version === providerUseVersion) setHostProviderUse({ serverId: server.id, off });
        return;
      }
      if (server?.kind !== "local") return;
      const status = await providersPort().setProviderOn({ provider, on });
      if (activeServer()?.id === server.id) flush(() => applyAgentStatus(status));
    }

    async function measureProviderDownload(provider: AgentProviderId): Promise<ProviderRuntimeDownload> {
      if (activeServer()?.kind !== "local" || !isManagedRuntimeProvider(provider)) return { bytes: 0, versions: 0 };
      return await providersPort().providerRuntimes.measureDownload(provider);
    }

    async function removeProviderDownload(provider: AgentProviderId): Promise<void> {
      const server = activeServer();
      if (server?.kind !== "local" || !isManagedRuntimeProvider(provider)) return;
      const snapshot = await providersPort().providerRuntimes.removeDownload(provider);
      if (activeServer()?.id === server.id) flush(() => runtimes.applyProviderRuntimeSnapshot(snapshot));
    }

    const accountsAdminServerId = createMemo(() => remoteAdminServer(activeServer(), PROVIDER_ACCOUNTS_CAPABILITY)?.id);
    const usageResetServerId = createMemo(() => remoteAdminServer(activeServer(), PROVIDER_USAGE_RESET_CAPABILITY)?.id);
    const signOutServerId = createMemo(() => remoteAdminServer(activeServer(), PROVIDER_SIGN_OUT_CAPABILITY)?.id);
    const accountPoolServerId = createMemo(
      () => remoteAdminServer(activeServer(), PROVIDER_ACCOUNT_POOL_CAPABILITY)?.id,
    );
    const accountCodeServerId = createMemo(
      () => remoteAdminServer(activeServer(), PROVIDER_ACCOUNT_CODE_CAPABILITY)?.id,
    );
    const liveVoiceAccountServerId = createMemo(
      () => remoteAdminServer(activeServer(), LIVE_VOICE_ACCOUNT_CAPABILITY)?.id,
    );
    const accountKeysServerId = createMemo(
      () => remoteAdminServer(activeServer(), PROVIDER_ACCOUNT_KEYS_CAPABILITY)?.id,
    );

    const providerAccounts = createMemo<ProviderAccountActions | undefined>(() => {
      const hostServerId = accountsAdminServerId();
      if (hostServerId) {
        const changed = async (request: Promise<void>) => {
          await request;
          await refreshHostAccounts();
        };
        return {
          connect: async (provider, accountId) => connection.connectAccount(provider, accountId),
          cancel: async (provider, accountId) => {
            await accountSignIn(hostServerId).cancel(provider);
            if (accountCodeServerId() === hostServerId) await accountCode(hostServerId).cancel(provider, accountId);
          },
          rename: (provider, accountId, label) =>
            changed(providerAdmin().renameAccount({ provider, accountId, label }, hostServerId)),
          remove: (provider, accountId) =>
            changed(providerAdmin().removeAccount({ provider, accountId }, hostServerId)),
          maxAccounts: serverSupportsCapability(activeServer(), PROVIDER_MANY_ACCOUNTS_CAPABILITY)
            ? PROVIDER_MANY_ACCOUNTS_LIMIT
            : PROVIDER_FROZEN_ACCOUNTS_LIMIT,
          ...(usageResetServerId() === hostServerId
            ? {
                usageResets: (provider: AgentProviderId) => providerAdmin().usageResets(provider, hostServerId),
                resetUsage: async (provider: AgentProviderId, accountId: string) => {
                  const outcome = await providerAdmin().resetUsage({ provider, accountId }, hostServerId);
                  await refreshHostAccountUsage().catch(() => undefined);
                  return outcome;
                },
              }
            : {}),
          ...(signOutServerId() === hostServerId
            ? { signOut: (provider: AgentProviderId) => changed(providerAdmin().signOut(provider, hostServerId)) }
            : {}),
          ...(accountPoolServerId() === hostServerId
            ? {
                setPool: (provider: AgentProviderId, enabled: boolean, leftOut: readonly string[]) =>
                  changed(providerAdmin().setAccountPool({ provider, enabled, leftOut: [...leftOut] }, hostServerId)),
              }
            : {}),
          ...(liveVoiceAccountServerId() === hostServerId
            ? {
                setLiveVoiceAccount: (accountId: string | null) =>
                  changed(providerAdmin().setLiveVoiceAccount({ accountId }, hostServerId)),
              }
            : {}),
          ...(accountCodeServerId() === hostServerId
            ? {
                connectWithCode: async (provider: AgentProviderId, accountId: string | null) =>
                  connection.connectAccountWithCode(provider, accountId),
                pasteCodeSignIn: serverSupportsCapability(activeServer(), "providers-v3"),
              }
            : {}),
          ...(accountKeysServerId() === hostServerId
            ? {
                connectKey: (provider: AgentProviderId, accountId: string | null, key: string) =>
                  changed(providerAdmin().connectAccountKey({ provider, accountId, key }, hostServerId)),
              }
            : {}),
        };
      }
      if (activeServer()?.kind !== "local") return undefined;
      const apply = async (request: Promise<AgentStatus>) => {
        const serverId = activeServer()?.id;
        const status = await request;
        if (activeServer()?.id === serverId) flush(() => applyAgentStatus(status));
      };
      return {
        connect: async (provider, accountId) => {
          await providersPort().connectProviderAccount({ provider, accountId });
        },
        connectWithCode: async (provider, accountId) => connection.connectAccountWithCode(provider, accountId),
        pasteCodeSignIn: pasteCodeSignInSupported(appInfo()?.platform ?? ""),
        connectKey: (provider, accountId, key) =>
          apply(providersPort().connectProviderAccountKey({ provider, accountId, key })),
        cancel: async (provider, accountId) => {
          await providersPort().cancelProviderAccountSignIn({ provider, accountId });
        },
        rename: (provider, accountId, label) =>
          apply(providersPort().renameProviderAccount({ provider, accountId, label })),
        remove: (provider, accountId) => apply(providersPort().removeProviderAccount({ provider, accountId })),
        usageResets: (provider) => providersPort().providerUsageResets(provider),
        resetUsage: (provider, accountId) => providersPort().resetProviderUsage({ provider, accountId }),
        signOut: (provider) => apply(providersPort().signOutProvider(provider)),
        setPool: (provider, enabled, leftOut) =>
          apply(providersPort().setProviderAccountPool({ provider, enabled, leftOut: [...leftOut] })),
        setLiveVoiceAccount: (accountId) => apply(providersPort().setLiveVoiceAccount({ accountId })),
        local: true,
      };
    });

    async function restartProvider(provider: AgentProviderId): Promise<void> {
      await changeProviderRestart(provider, providersPort().restartProvider);
    }

    async function cancelProviderRestart(provider: AgentProviderId): Promise<void> {
      await changeProviderRestart(provider, providersPort().cancelProviderRestart);
    }

    async function chooseInstalledCli(provider: ManagedProviderId, installed: boolean): Promise<void> {
      await changeProviderRestart(provider, () => providersPort().chooseInstalledCli({ provider, installed }));
    }

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

    function accountCode(serverId: string) {
      const refresh = () =>
        serverId === LOCAL_SERVER_ID ? Promise.resolve() : refreshHostAccounts().catch(() => undefined);
      return {
        start: async (provider: AgentProviderId, accountId: string | null) => {
          const started = await providerAdmin().startAccountCodeLogin({ provider, accountId }, serverId);
          void refresh();
          return started;
        },
        submit: (provider: AgentProviderId, accountId: string, code: string) =>
          providerAdmin().submitAccountCodeLogin({ provider, accountId, code }, serverId),
        status: async (provider: AgentProviderId, accountId: string) => {
          const status = await providerAdmin().accountCodeLoginStatus({ provider, accountId }, serverId);
          if (status.result) await refresh();
          return status;
        },
        cancel: async (provider: AgentProviderId, accountId: string) => {
          await providerAdmin().cancelAccountCodeLogin({ provider, accountId }, serverId);
          await refresh();
        },
      };
    }

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
              ...(accountCodeServerId() === serverId ? { accountCode: accountCode(serverId) } : {}),
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
              accountCode: accountCode(LOCAL_SERVER_ID),
            };
      },
      place: () =>
        providerAdminServerId()
          ? { kind: "app-server", server: activeServer() }
          : activeServer()?.kind === "remote"
            ? null
            : { kind: "computer", platform: appInfo()?.platform },
      connectInBrowser: connectProvider,
      connectInMainlandChina: connectProviderInMainlandChina,
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
      providerUseServerId,
      hostOffProviders,
      refreshHostProviderUse,
      providerKeys,
      hostCustomProviders,
      customAgentsServerId,
      hostCustomAgents,
      activeCustomProviders,
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
      chooseInstalledCli,
    };
  },
});

export const ProvidersProvider = Providers.provider;
export const useProviders = Providers.use;

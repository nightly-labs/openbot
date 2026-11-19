import { isKeyOnlyProvider, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import { bugReportFormUrl } from "@openbot/contracts/feedback";
import type {
  AgentProviderId,
  AgentStatus,
  ExternalDestination,
  HostDefaultProvider,
  ProviderAdminDesktopApi,
  ServerSummary,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { decodeRegistryEntries, decodeRegistryInstallResult, decodeRegistryOperations } from "@openbot/contracts/ipc";
import { ACP_REGISTRY_ROUTES } from "@openbot/contracts/team-protocol/acp-registry-v1";
import { CLAUDE_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { CODEX_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/codex-api-key-v1";
import { CUSTOM_AGENTS_CAPABILITY } from "@openbot/contracts/team-protocol/custom-agents-v1";
import {
  CUSTOM_PROVIDER_EDIT_CAPABILITY,
  CUSTOM_PROVIDER_EDIT_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-edit-v1";
import {
  CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-harness-choice-v1";
import {
  CUSTOM_PROVIDER_HARNESS_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import { PROVIDER_ACCOUNT_CODE_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-code-v1";
import { PROVIDER_ACCOUNT_KEYS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-keys-v1";
import { PROVIDER_ACCOUNT_MODELS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-models-v1";
import { PROVIDER_ACCOUNT_POOL_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import {
  type ProviderAccountRelay,
  providerAccountRelay,
} from "@openbot/contracts/team-protocol/provider-account-relays";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  decodeDetectedAgents,
  decodeDetectedModelServers,
  decodeDetectionSettings,
  decodeDiscoveredModels,
  PROVIDER_DETECTION_CAPABILITY,
  PROVIDER_DETECTION_ROUTES,
} from "@openbot/contracts/team-protocol/provider-detection-v1";
import { PROVIDER_SIGN_OUT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDER_USE_CAPABILITY } from "@openbot/contracts/team-protocol/provider-use-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import {
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v2";
import {
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v3";
import { PROVIDERS_V4_CAPABILITY, PROVIDERS_V4_ROUTES } from "@openbot/contracts/team-protocol/providers-v4";
import { PROVIDERS_V5_CAPABILITY, PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { runTeamEffect } from "@openbot/team-client";
import {
  type CustomProviderRoutes,
  cancelProviderAccountCodeLogin,
  cancelProviderAccountSignIn,
  cancelProviderCodeLogin,
  cancelProviderHostSignIn,
  cancelProviderRuntime,
  checkProviderRuntimeUpdates,
  clearProviderApiKey,
  connectProviderAccountKey,
  deleteCustomAgent,
  deleteCustomProvider,
  downloadProviderRuntime,
  getHostProviderDefault,
  getProviderApiKeyState,
  getProviderRuntimes,
  getProviderUse,
  type HostProviderDefault,
  listCustomAgents,
  listCustomProviders,
  listProviderAccountsWithModels,
  type ProviderCodeLoginRoutes,
  type ProviderRuntimeRoutes,
  providerAccountCodeLoginStatus,
  providerAccountSignInStatus,
  providerAccountUsage,
  providerHostSignInStatus,
  providerUsageResets,
  removeProviderAccount,
  renameProviderAccount,
  resetProviderUsage,
  saveCustomAgent,
  saveCustomProvider,
  setHostProviderDefault,
  setProviderAccountPool,
  setProviderApiKey,
  setProviderUse,
  signOutProvider,
  startProviderAccountCodeLogin,
  startProviderAccountSignIn,
  startProviderCodeLogin,
  startProviderHostSignIn,
  submitProviderAccountCodeLogin,
  submitProviderCodeLogin,
  updateCustomProvider,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import type { ProviderAccountActions } from "@openbot/ui/components/provider-accounts";
import { isAgentAccount } from "@openbot/ui/components/provider-accounts";
import type { AgentProfile } from "@openbot/ui/data";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import type { AcpRegistrySettingsApi } from "@openbot/ui/features/custom-providers/AcpRegistrySettings";
import type { CustomAgentSettingsApi } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import { providerDiagnosticsText } from "@openbot/ui/features/provider-diagnostics/provider-diagnostics";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { createHostAccounts, withHostAccounts, withHostProfileAccount } from "../agents/host-provider-accounts";
import type { CustomAgentsEndpointApi } from "../custom-agents/custom-agents-port";
import { createCustomAgentsStore } from "../custom-agents/stores/custom-agents-store";
import { hostCustomProvidersApi } from "../custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "../custom-providers/stores/custom-providers-store";
import {
  createProviderDetectionStore,
  type ProviderDetectionCalls,
} from "../custom-providers/stores/provider-detection-store";
import { createProviderConnection } from "../provider-updates/provider-connection";
import { createProviderRuntimeStore, hostConnection } from "../provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "../provider-updates/remote-provider-runtimes";
import { remoteAdminServer, serverCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import type { HostProviderSettings } from "../settings/ProviderSettingsSection";
import { hostProviderKeyApi } from "../settings/provider-key-api";
import { webProviderRelay } from "./web-provider-relay";

const CODE_LOGIN_POLL_MS = 3000;

const WEB_EXTERNAL_DESTINATIONS: Partial<Record<ExternalDestination, string>> = {
  "opencode-auth": "https://opencode.ai/auth",
  feedback: "https://x.com/intent/post?text=Feedback%20for%20OpenBot%20%40norbertbodziony%3A%20",
  "report-problem": bugReportFormUrl({ platform: "Web client" }),
  message: "https://x.com/norbertbodziony",
  changelog: "https://openbot.run/changelog",
  guides: "https://openbot.run/guides",
  discord: "https://discord.openbot.run",
  x: "https://x.com/OpenBot_",
};

export function openWebDestination(destination: ExternalDestination): Promise<void> {
  const url = WEB_EXTERNAL_DESTINATIONS[destination];
  if (!url) return Promise.reject(new Error(currentText().t("webClient.error.linkDesktopOnly")));
  window.open(url, "_blank", "noopener");
  return Promise.resolve();
}

function knownHostDefault({ provider, model }: HostProviderDefault): HostDefaultProvider {
  return provider !== null && isKnownAgentProvider(provider)
    ? { preferredProvider: provider, preferredModel: model }
    : { preferredProvider: null, preferredModel: null };
}

function webProviderAdmin(
  request: (serverId?: string) => TeamApiRequest,
  runtimeRoutes: () => ProviderRuntimeRoutes,
  signInRoutes: () => ProviderCodeLoginRoutes,
  keyRoutes: () => typeof PROVIDERS_ADMIN_ROUTES | typeof PROVIDERS_V5_ROUTES | typeof PROVIDERS_V8_ROUTES,
  customRoutes: () => CustomProviderRoutes,
  accountRelay: () => ProviderAccountRelay | null,
  accountModels: () => boolean,
  accountPools: () => boolean,
): ProviderAdminDesktopApi {
  return {
    startCodeLogin: async (provider, serverId) =>
      runTeamEffect(
        startProviderCodeLogin(request(serverId), provider, signInRoutes()).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    submitCodeLogin: async (input, serverId) => {
      const routes = signInRoutes();
      return runTeamEffect(
        submitProviderCodeLogin(
          request(serverId),
          input,
          routes === PROVIDERS_V8_ROUTES || routes === PROVIDERS_V4_ROUTES ? routes : PROVIDERS_SIGN_IN_V3_ROUTES,
        ).pipe(Effect.mapError((error) => error.cause)),
      );
    },
    cancelCodeLogin: async (provider, serverId) =>
      runTeamEffect(
        cancelProviderCodeLogin(request(serverId), provider, signInRoutes()).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    startHostSignIn: async (provider, serverId) =>
      runTeamEffect(startProviderHostSignIn(request(serverId), provider).pipe(Effect.mapError((error) => error.cause))),
    hostSignInStatus: async (provider, serverId) =>
      runTeamEffect(
        providerHostSignInStatus(request(serverId), provider).pipe(Effect.mapError((error) => error.cause)),
      ),
    cancelHostSignIn: async (provider, serverId) =>
      runTeamEffect(
        cancelProviderHostSignIn(request(serverId), provider).pipe(Effect.mapError((error) => error.cause)),
      ),
    getApiKeyState: async (provider, serverId) =>
      runTeamEffect(
        getProviderApiKeyState(request(serverId), provider, keyRoutes()).pipe(Effect.mapError((error) => error.cause)),
      ),
    setApiKey: async (input, serverId) =>
      runTeamEffect(
        setProviderApiKey(request(serverId), input, keyRoutes()).pipe(Effect.mapError((error) => error.cause)),
      ),
    clearApiKey: async (provider, serverId) =>
      runTeamEffect(
        clearProviderApiKey(request(serverId), provider, keyRoutes()).pipe(Effect.mapError((error) => error.cause)),
      ),
    getRuntimes: async (serverId) =>
      runTeamEffect(
        getProviderRuntimes(request(serverId), runtimeRoutes()).pipe(Effect.mapError((error) => error.cause)),
      ),
    downloadRuntime: async (provider, serverId) =>
      runTeamEffect(
        downloadProviderRuntime(request(serverId), provider, runtimeRoutes()).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    cancelRuntime: async (provider, serverId) =>
      runTeamEffect(
        cancelProviderRuntime(request(serverId), provider, runtimeRoutes()).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    checkRuntimeUpdates: async (serverId) =>
      runTeamEffect(
        checkProviderRuntimeUpdates(request(serverId), runtimeRoutes()).pipe(Effect.mapError((error) => error.cause)),
      ),
    listCustomProviders: async (serverId) =>
      runTeamEffect(
        listCustomProviders(request(serverId), customRoutes()).pipe(Effect.mapError((error) => error.cause)),
      ),
    saveCustomProvider: async (input, serverId) =>
      runTeamEffect(
        saveCustomProvider(request(serverId), input, customRoutes()).pipe(Effect.mapError((error) => error.cause)),
      ),
    updateCustomProvider: async (input, serverId) => {
      const routes = customRoutes();
      if (!("customUpdate" in routes)) throw new Error(currentText().t("error.provider.localOnly"));
      return runTeamEffect(
        updateCustomProvider(request(serverId), input, routes).pipe(Effect.mapError((error) => error.cause)),
      );
    },
    deleteCustomProvider: async (input, serverId) =>
      runTeamEffect(
        deleteCustomProvider(request(serverId), input, customRoutes()).pipe(Effect.mapError((error) => error.cause)),
      ),
    accounts: async (serverId) =>
      runTeamEffect(
        listProviderAccountsWithModels(request(serverId), accountModels(), accountPools()).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    accountUsage: async (serverId) =>
      runTeamEffect(providerAccountUsage(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
    startAccountSignIn: async (input, serverId) =>
      runTeamEffect(startProviderAccountSignIn(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    accountSignInStatus: async (provider, serverId) =>
      runTeamEffect(
        providerAccountSignInStatus(request(serverId), provider).pipe(Effect.mapError((error) => error.cause)),
      ),
    cancelAccountSignIn: async (provider, serverId) =>
      runTeamEffect(
        cancelProviderAccountSignIn(request(serverId), provider).pipe(Effect.mapError((error) => error.cause)),
      ),
    connectAccountKey: async (input, serverId) =>
      runTeamEffect(connectProviderAccountKey(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    startAccountCodeLogin: async (input, serverId) =>
      runTeamEffect(
        startProviderAccountCodeLogin(request(serverId), input).pipe(Effect.mapError((error) => error.cause)),
      ),
    submitAccountCodeLogin: async (input, serverId) =>
      runTeamEffect(
        submitProviderAccountCodeLogin(request(serverId), input).pipe(Effect.mapError((error) => error.cause)),
      ),
    accountCodeLoginStatus: async (input, serverId) =>
      runTeamEffect(
        providerAccountCodeLoginStatus(request(serverId), input).pipe(Effect.mapError((error) => error.cause)),
      ),
    cancelAccountCodeLogin: async (input, serverId) =>
      runTeamEffect(
        cancelProviderAccountCodeLogin(request(serverId), input).pipe(Effect.mapError((error) => error.cause)),
      ),
    renameAccount: async (input, serverId) =>
      runTeamEffect(renameProviderAccount(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    removeAccount: async (input, serverId) =>
      runTeamEffect(removeProviderAccount(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    setAccountPool: async (input, serverId) =>
      runTeamEffect(setProviderAccountPool(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    hostDefaultProvider: async (serverId) =>
      knownHostDefault(
        await runTeamEffect(getHostProviderDefault(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
      ),
    setHostDefaultProvider: async ({ preferredProvider, preferredModel }, serverId) =>
      knownHostDefault(
        await runTeamEffect(
          setHostProviderDefault(request(serverId), preferredProvider, preferredModel).pipe(
            Effect.mapError((error) => error.cause),
          ),
        ),
      ),
    usageResets: async (provider, serverId) =>
      runTeamEffect(providerUsageResets(request(serverId), provider).pipe(Effect.mapError((error) => error.cause))),
    resetUsage: async (input, serverId) =>
      runTeamEffect(resetProviderUsage(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    signOut: async (provider, serverId) =>
      runTeamEffect(signOutProvider(request(serverId), provider).pipe(Effect.mapError((error) => error.cause))),
    providerUse: async (serverId) =>
      runTeamEffect(getProviderUse(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
    setProviderUse: async ({ provider, on }, serverId) =>
      runTeamEffect(setProviderUse(request(serverId), provider, on).pipe(Effect.mapError((error) => error.cause))),
    ...webProviderRelay(request, accountRelay),
  };
}

function webCustomAgentsApi(request: (serverId?: string) => TeamApiRequest, serverId: string): CustomAgentsEndpointApi {
  return {
    list: async () => runTeamEffect(listCustomAgents(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
    save: async (input) =>
      runTeamEffect(saveCustomAgent(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    delete: async ({ id }) =>
      runTeamEffect(deleteCustomAgent(request(serverId), id).pipe(Effect.mapError((error) => error.cause))),
  };
}

function webProviderDetectionCalls(send: TeamApiRequest): ProviderDetectionCalls {
  return {
    scanModelServers: () => send("POST", PROVIDER_DETECTION_ROUTES.scanModelServers, decodeDetectedModelServers, {}),
    scanAgents: () => send("POST", PROVIDER_DETECTION_ROUTES.scanAgents, decodeDetectedAgents, {}),
    discoverModels: (input) =>
      send("POST", PROVIDER_DETECTION_ROUTES.discoverModels, decodeDiscoveredModels, {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        headers: input.headers.map((header) => ({ name: header.name, value: header.value })),
        ...(input.savedProviderId === undefined ? {} : { savedProviderId: input.savedProviderId }),
      }),
    getSettings: () => send("POST", PROVIDER_DETECTION_ROUTES.settings, decodeDetectionSettings, {}),
    setSettings: (settings) =>
      send("POST", PROVIDER_DETECTION_ROUTES.updateSettings, decodeDetectionSettings, {
        enabled: settings.enabled,
        addresses: settings.addresses,
        folders: settings.folders,
        hiddenIds: settings.hiddenIds,
      }),
  };
}

export interface WebProviderSettingsOptions {
  server: () => ServerSummary | undefined;
  request: (serverId?: string) => TeamApiRequest;
  status: () => AgentStatus;
  setStatus: (status: AgentStatus) => void;
  readStatus: () => Promise<AgentStatus>;
  browser: BrowserViewRuntime;
  agents: () => readonly AgentProfile[];
}

export function createWebProviderSettings(options: WebProviderSettingsOptions) {
  const accountRelayOfServer = () =>
    providerAccountRelay((capability) => serverSupportsCapability(options.server(), capability));
  const admin = webProviderAdmin(
    options.request,
    () =>
      serverSupportsCapability(options.server(), PROVIDERS_V8_CAPABILITY)
        ? PROVIDERS_V8_ROUTES
        : serverSupportsCapability(options.server(), PROVIDERS_V5_CAPABILITY)
          ? PROVIDERS_V5_ROUTES
          : serverSupportsCapability(options.server(), PROVIDERS_V4_CAPABILITY)
            ? PROVIDERS_V4_ROUTES
            : serverSupportsCapability(options.server(), PROVIDERS_RUNTIMES_V2_CAPABILITY)
              ? PROVIDERS_RUNTIMES_V2_ROUTES
              : PROVIDERS_ADMIN_ROUTES,
    () =>
      serverSupportsCapability(options.server(), PROVIDERS_V8_CAPABILITY)
        ? PROVIDERS_V8_ROUTES
        : serverSupportsCapability(options.server(), PROVIDERS_V4_CAPABILITY)
          ? PROVIDERS_V4_ROUTES
          : serverSupportsCapability(options.server(), PROVIDERS_SIGN_IN_V3_CAPABILITY)
            ? PROVIDERS_SIGN_IN_V3_ROUTES
            : PROVIDERS_ADMIN_ROUTES,
    () =>
      serverSupportsCapability(options.server(), PROVIDERS_V8_CAPABILITY)
        ? PROVIDERS_V8_ROUTES
        : serverSupportsCapability(options.server(), PROVIDERS_V5_CAPABILITY)
          ? PROVIDERS_V5_ROUTES
          : PROVIDERS_ADMIN_ROUTES,
    () =>
      serverSupportsCapability(options.server(), CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY)
        ? CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES
        : serverSupportsCapability(options.server(), CUSTOM_PROVIDER_EDIT_CAPABILITY)
          ? CUSTOM_PROVIDER_EDIT_ROUTES
          : serverSupportsCapability(options.server(), CUSTOM_PROVIDER_HARNESS_CAPABILITY)
            ? CUSTOM_PROVIDER_HARNESS_ROUTES
            : PROVIDERS_ADMIN_ROUTES,
    accountRelayOfServer,
    () => serverSupportsCapability(options.server(), PROVIDER_ACCOUNT_MODELS_CAPABILITY),
    () => serverSupportsCapability(options.server(), PROVIDER_ACCOUNT_POOL_CAPABILITY),
  );
  const serverId = createMemo(() => remoteAdminServer(options.server(), "providers-v1")?.id);
  const runtimes = createProviderRuntimeStore(
    createMemo(() => {
      const id = serverId();
      return id ? remoteProviderRuntimes(() => admin, id) : undefined;
    }),
    {
      systemCliVersion: (provider) => {
        const row = options.status().providers?.find((candidate) => candidate.id === provider);
        return row?.cliSource === "system" ? (row.version ?? null) : null;
      },
      isLocalServer: () => false,
      managesRuntimes: () => serverId() !== undefined,
      hostConnection: () => hostConnection(options.server()),
    },
  );
  const editsCustomProviders = createMemo(() =>
    serverSupportsCapability(options.server(), CUSTOM_PROVIDER_EDIT_CAPABILITY),
  );
  const customProviders = createMemo(() => {
    const id = serverId();
    editsCustomProviders();
    if (!id) return undefined;
    const store = createCustomProvidersStore(() => hostCustomProvidersApi(() => admin, id));
    void untrack(() => store.refreshCustomProviders()).catch(() => undefined);
    return store;
  });
  const readsClaudeKey = createMemo(() => serverSupportsCapability(options.server(), CLAUDE_API_KEY_CAPABILITY));
  const readsCodexKey = createMemo(() => serverSupportsCapability(options.server(), CODEX_API_KEY_CAPABILITY));
  const providerKeys = createMemo(() => {
    const id = serverId();
    if (!id) return undefined;
    const api = hostProviderKeyApi(() => admin, id, openWebDestination);
    return {
      ...api,
      readsClaudeKey: readsClaudeKey(),
      readsCodexKey: readsCodexKey(),
      setProviderApiKey: async (input: { provider: AgentProviderId; key: string }) => {
        const result = await api.setProviderApiKey(input);
        if (isKeyOnlyProvider(input.provider)) runtimes.refreshProviderRuntimes();
        return result;
      },
    };
  });
  const accountsServerId = createMemo(() => remoteAdminServer(options.server(), PROVIDER_ACCOUNTS_CAPABILITY)?.id);
  const hostAccounts = createHostAccounts({
    serverId: accountsServerId,
    accounts: (id) => admin.accounts(id),
    usage: (id) => admin.accountUsage(id),
  });
  const status = createMemo(() => withHostAccounts(options.status(), hostAccounts.host()));
  const providerUseServerId = createMemo(() => remoteAdminServer(options.server(), PROVIDER_USE_CAPABILITY)?.id);
  const [providerUse, setProviderUse] = createSignal<{ serverId: string; off: AgentProviderId[] }>();
  let providerUseVersion = 0;
  function refreshProviderUse(): void {
    const id = providerUseServerId();
    if (!id) return;
    const version = ++providerUseVersion;
    void admin
      .providerUse(id)
      .then((off) => {
        if (version === providerUseVersion) setProviderUse({ serverId: id, off });
      })
      .catch(() => undefined);
  }
  createEffect(providerUseServerId, () => untrack(refreshProviderUse));
  async function setProviderOn(provider: AgentProviderId, on: boolean): Promise<void> {
    const id = providerUseServerId();
    if (!id) return;
    const version = ++providerUseVersion;
    const off = await admin.setProviderUse({ provider, on }, id);
    if (version === providerUseVersion) setProviderUse({ serverId: id, off });
  }
  createEffect(options.status, hostAccounts.schedule);
  createEffect(options.agents, hostAccounts.schedule);
  const connection = createProviderConnection({
    agentStatus: status,
    applyStatus: options.setStatus,
    target: () => {
      const id = serverId();
      const relayed = accountsServerId() ? accountRelayOfServer() : null;
      return {
        start: (provider: AgentProviderId) => admin.startCodeLogin(provider, id ?? ""),
        submit: (provider: AgentProviderId, code: string) => admin.submitCodeLogin({ provider, code }, id ?? ""),
        cancel: (provider: AgentProviderId) => admin.cancelCodeLogin(provider, id ?? ""),
        hostSignIn: {
          hostName: options.server()?.name ?? "",
          runtime: options.browser,
          clipboard: serverSupportsCapability(options.server(), "browser-view-clipboard"),
          start: (provider: AgentProviderId) => admin.startHostSignIn(provider, id ?? ""),
          status: (provider: AgentProviderId) => admin.hostSignInStatus(provider, id ?? ""),
          cancel: (provider: AgentProviderId) => admin.cancelHostSignIn(provider, id ?? ""),
        },
        ...(accountsServerId() ? { accountSignIn: accountSignIn(accountsServerId() ?? "") } : {}),
        ...(relayed ? { accountRelay: accountRelay(accountsServerId() ?? "", relayed) } : {}),
        ...(accountCodeServerId() ? { accountCode: accountCode(accountCodeServerId() ?? "") } : {}),
        relay: {
          hostName: options.server()?.name ?? "",
          start: (provider: AgentProviderId) => admin.startRelaySignIn(provider, id ?? ""),
          status: (provider: AgentProviderId) => admin.relaySignInStatus(provider, id ?? ""),
          open: (provider: AgentProviderId) => admin.openRelaySignIn(provider, id ?? ""),
          paste: (provider: AgentProviderId, address: string) =>
            admin.pasteRelaySignIn({ provider, address }, id ?? ""),
          cancel: (provider: AgentProviderId) => admin.cancelRelaySignIn(provider, id ?? ""),
        },
      };
    },
    place: () => ({ kind: "web-server", server: options.server() }),
    openVerificationUrl: (url) => void window.open(url, "_blank", "noopener"),
    openAppDownload: () => void window.open("/download", "_blank", "noopener"),
  });
  function accountSignIn(id: string) {
    return {
      hostName: options.server()?.name ?? "",
      runtime: options.browser,
      clipboard: serverSupportsCapability(options.server(), "browser-view-clipboard"),
      start: (provider: AgentProviderId, accountId: string | null) =>
        admin.startAccountSignIn({ provider, accountId }, id),
      status: async (provider: AgentProviderId) => {
        const result = await admin.accountSignInStatus(provider, id);
        if (result.result) await hostAccounts.refresh().catch(() => undefined);
        return result;
      },
      cancel: async (provider: AgentProviderId) => {
        await admin.cancelAccountSignIn(provider, id);
        await hostAccounts.refresh().catch(() => undefined);
        return status();
      },
    };
  }
  const accountCodeServerId = () => {
    const id = accountsServerId();
    return id && remoteAdminServer(options.server(), PROVIDER_ACCOUNT_CODE_CAPABILITY)?.id === id ? id : undefined;
  };
  function accountCode(id: string) {
    const refresh = () => hostAccounts.refresh().catch(() => undefined);
    return {
      start: async (provider: AgentProviderId, accountId: string | null) => {
        const started = await admin.startAccountCodeLogin({ provider, accountId }, id);
        void refresh();
        return started;
      },
      submit: (provider: AgentProviderId, accountId: string, code: string) =>
        admin.submitAccountCodeLogin({ provider, accountId, code }, id),
      status: async (provider: AgentProviderId, accountId: string) => {
        const result = await admin.accountCodeLoginStatus({ provider, accountId }, id);
        if (result.result) await refresh();
        return result;
      },
      cancel: async (provider: AgentProviderId, accountId: string) => {
        await admin.cancelAccountCodeLogin({ provider, accountId }, id);
        await refresh();
      },
    };
  }
  function accountRelay(id: string, relayed: ProviderAccountRelay) {
    return {
      providers: relayed.providers,
      hostName: options.server()?.name ?? "",
      start: (provider: AgentProviderId, accountId: string | null) =>
        admin.startAccountRelaySignIn({ provider, accountId }, id),
      status: async (provider: AgentProviderId) => {
        const result = await admin.relaySignInStatus(provider, id);
        if (result.result) await hostAccounts.refresh().catch(() => undefined);
        return result;
      },
      open: (provider: AgentProviderId) => admin.openRelaySignIn(provider, id),
      paste: (provider: AgentProviderId, address: string) => admin.pasteRelaySignIn({ provider, address }, id),
      cancel: async (provider: AgentProviderId) => {
        const result = await admin.cancelRelaySignIn(provider, id);
        await hostAccounts.refresh().catch(() => undefined);
        return result;
      },
    };
  }
  const accountActions = createMemo<ProviderAccountActions | undefined>(() => {
    const id = accountsServerId();
    if (!id) return undefined;
    const changed = async (request: Promise<void>) => {
      await request;
      await hostAccounts.refresh();
    };
    return {
      connect: async (provider, accountId) => connection.connectAccount(provider, accountId),
      cancel: async (provider, accountId) => {
        await accountSignIn(id).cancel(provider);
        if (accountCodeServerId() === id) await accountCode(id).cancel(provider, accountId);
      },
      rename: (provider, accountId, label) => changed(admin.renameAccount({ provider, accountId, label }, id)),
      remove: (provider, accountId) => changed(admin.removeAccount({ provider, accountId }, id)),
      ...(remoteAdminServer(options.server(), PROVIDER_USAGE_RESET_CAPABILITY)?.id === id
        ? {
            usageResets: (provider: AgentProviderId) => admin.usageResets(provider, id),
            resetUsage: async (provider: AgentProviderId, accountId: string) => {
              const outcome = await admin.resetUsage({ provider, accountId }, id);
              await hostAccounts.refreshUsage().catch(() => undefined);
              return outcome;
            },
          }
        : {}),
      ...(remoteAdminServer(options.server(), PROVIDER_SIGN_OUT_CAPABILITY)?.id === id
        ? { signOut: (provider: AgentProviderId) => changed(admin.signOut(provider, id)) }
        : {}),
      ...(remoteAdminServer(options.server(), PROVIDER_ACCOUNT_POOL_CAPABILITY)?.id === id
        ? {
            setPool: (provider: AgentProviderId, enabled: boolean, leftOut: readonly string[]) =>
              changed(admin.setAccountPool({ provider, enabled, leftOut: [...leftOut] }, id)),
          }
        : {}),
      ...(accountCodeServerId() === id
        ? {
            connectWithCode: async (provider: AgentProviderId, accountId: string | null) =>
              connection.connectAccountWithCode(provider, accountId),
            pasteCodeSignIn: serverSupportsCapability(options.server(), "providers-v3"),
          }
        : {}),
      ...(remoteAdminServer(options.server(), PROVIDER_ACCOUNT_KEYS_CAPABILITY)?.id === id
        ? {
            connectKey: (provider: AgentProviderId, accountId: string | null, key: string) =>
              changed(admin.connectAccountKey({ provider, accountId, key }, id)),
          }
        : {}),
    };
  });
  createEffect(
    () => connection.provider() !== null && connection.state().phase !== "starting",
    (waiting) => {
      if (!waiting) return;
      const host = serverId();
      const timer = window.setInterval(() => {
        options.readStatus().then(
          (status) => {
            if (serverId() === host) options.setStatus(status);
          },
          () => undefined,
        );
      }, CODE_LOGIN_POLL_MS);
      return () => window.clearInterval(timer);
    },
  );

  const registry = createMemo((): AcpRegistrySettingsApi | undefined => {
    const id = serverId();
    if (!id || !serverSupportsCapability(options.server(), "acp-registry-v1")) return undefined;
    const send = options.request(id);
    const empty = () => undefined;
    return {
      search: (query) => send("POST", ACP_REGISTRY_ROUTES.search, decodeRegistryEntries, { query }),
      status: () => send("POST", ACP_REGISTRY_ROUTES.status, decodeRegistryOperations, {}),
      install: (input) => send("POST", ACP_REGISTRY_ROUTES.install, decodeRegistryInstallResult, { ...input }),
      cancel: (registryId) => send("POST", ACP_REGISTRY_ROUTES.cancel, empty, { registryId }),
      remove: (registryId) => send("POST", ACP_REGISTRY_ROUTES.remove, empty, { registryId }),
    };
  });
  const customAgentsServerId = createMemo(() => remoteAdminServer(options.server(), CUSTOM_AGENTS_CAPABILITY)?.id);
  const customAgentsStore = createMemo(() => {
    const id = customAgentsServerId();
    if (!id) return undefined;
    const store = createCustomAgentsStore(() => webCustomAgentsApi(options.request, id));
    void store.refreshCustomAgents().catch(() => undefined);
    return store;
  });
  const customAgents = createMemo((): CustomAgentSettingsApi | undefined => {
    const store = customAgentsStore();
    if (!store) return undefined;
    const acp = () => status().providers?.find((provider) => provider.id === "acp");
    return {
      host: true,
      get agents() {
        return store.customAgents();
      },
      save: store.saveCustomAgent,
      remove: store.deleteCustomAgent,
      get restartPending() {
        return acp()?.restartPending === true;
      },
      get lastError() {
        return acp()?.lastError;
      },
      get diagnostics() {
        const row = acp();
        return row ? providerDiagnosticsText(row) : undefined;
      },
    };
  });
  const detection = createMemo(() => {
    const id = serverId();
    const endpoints = customProviders();
    const agents = customAgentsStore();
    if (!id || !endpoints || !agents || !serverCanAdminister(options.server(), PROVIDER_DETECTION_CAPABILITY)) {
      return undefined;
    }
    const send = options.request(id);
    return createProviderDetectionStore({
      api: () => webProviderDetectionCalls(send),
      endpoints,
      agents: { customAgents: agents.customAgents, saveCustomAgent: agents.saveCustomAgent },
    });
  });
  const updateEndpoint = async (value: UpdateCustomProviderInput) => {
    const store = customProviders();
    if (!store) throw new Error(currentText().t("webClient.error.saveEndpointOffline"));
    return store.updateCustomProvider(value);
  };
  const settings: HostProviderSettings = {
    get acpRegistry() {
      return registry();
    },
    get agentStatus() {
      return status();
    },
    get accountActions() {
      return accountActions();
    },
    get providerUsers() {
      return Object.fromEntries(
        (status().providers ?? []).map((provider) => [
          provider.id,
          options
            .agents()
            .filter((agent) => agent.provider === provider.id)
            .map((agent) => agent.name),
        ]),
      );
    },
    get providerAccountUsers() {
      const host = hostAccounts.host();
      const agents = host ? options.agents().map((agent) => withHostProfileAccount(agent, host)) : options.agents();
      return Object.fromEntries(
        (status().providers ?? []).map((provider) => [
          provider.id,
          Object.fromEntries(
            (provider.accounts ?? []).map((account) => [
              account.id,
              agents
                .filter(
                  (agent) => agent.provider === provider.id && isAgentAccount(agent.providerAccountId, account.id),
                )
                .map((agent) => agent.name),
            ]),
          ),
        ]),
      );
    },
    get offProviders() {
      const id = providerUseServerId();
      const use = providerUse();
      return id && use?.serverId === id ? use.off : undefined;
    },
    get onSetProviderOn() {
      return providerUseServerId() ? setProviderOn : undefined;
    },
    get providerRuntimeStatuses() {
      return runtimes.providerRuntimeStatuses();
    },
    get providerAvailableVersions() {
      return runtimes.providerAvailableVersions();
    },
    onDownloadProvider: (provider) => runtimes.downloadProviderRuntime(provider),
    onCancelProviderDownload: (provider) => runtimes.cancelProviderRuntimeDownload(provider),
    onUpdateProvider: (provider) => runtimes.startProviderUpdate(provider),
    get customProviders() {
      return customProviders()?.customProviders() ?? [];
    },
    onAddCustomProvider: async (value) => {
      const store = customProviders();
      if (!store) throw new Error(currentText().t("webClient.error.saveEndpointOffline"));
      return store.saveCustomProvider(value);
    },
    onDeleteCustomProvider: async (id) => {
      const store = customProviders();
      if (!store) throw new Error(currentText().t("webClient.error.removeEndpointOffline"));
      return store.deleteCustomProvider(id);
    },
    get onUpdateCustomProvider() {
      const editable =
        editsCustomProviders() &&
        (customProviders()?.customProviders() ?? []).every((provider) => provider.headerNames !== undefined);
      return editable ? updateEndpoint : undefined;
    },
    get customProviderHarnessChoice() {
      return serverSupportsCapability(options.server(), CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY);
    },
    get providerKeys() {
      return providerKeys();
    },
    get customAgents() {
      return customAgents();
    },
    get providerDetection() {
      return detection()?.detection();
    },
    get detectedProviderApi() {
      return detection()?.api;
    },
    get takenAgentIds() {
      return detection()?.takenAgentIds();
    },
    get detectionSettings() {
      return detection()?.settingsValue() ?? undefined;
    },
    get onDetectionSettingsChange() {
      return detection()?.setSettings;
    },
    get detectionSettingsError() {
      return detection()?.settingsError() ?? null;
    },
    get onShown() {
      const store = detection();
      const readsUse = providerUseServerId() !== undefined;
      if (!store && !readsUse) return undefined;
      return () => {
        if (store) void store.scan();
        if (readsUse) refreshProviderUse();
      };
    },
    connection,
  };
  return {
    settings: (): HostProviderSettings | undefined => (serverId() ? settings : undefined),
    hostDefaultProviderCalls: admin,
    status,
    hostAccounts,
  };
}

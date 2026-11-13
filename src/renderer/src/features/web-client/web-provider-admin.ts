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
  CUSTOM_PROVIDER_HARNESS_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
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
  startProviderAccountSignIn,
  startProviderCodeLogin,
  startProviderHostSignIn,
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
import { createProviderRuntimeStore } from "../provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "../provider-updates/remote-provider-runtimes";
import { remoteAdminServer, serverCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import type { HostProviderSettings } from "../settings/ProviderSettingsSection";
import { hostProviderKeyApi } from "../settings/provider-key-api";
import { webProviderRelay } from "./web-provider-relay";

/** How often the host status is read while a code sign-in waits, in case a status event is lost. */
const CODE_LOGIN_POLL_MS = 3000;

/**
 * The pages the key dialog, the Help menu and the community card link to. The desktop app keeps its table in main; the
 * browser has no main process, so the pages it opens are listed here, and any other name is refused.
 */
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

/** A provider that this build does not know reads as none, as main reads it on the desktop. */
function knownHostDefault({ provider, model }: HostProviderDefault): HostDefaultProvider {
  return provider !== null && isKnownAgentProvider(provider)
    ? { preferredProvider: provider, preferredModel: model }
    : { preferredProvider: null, preferredModel: null };
}

/**
 * The desktop `providerAdmin` group, answered over the Team API of the connected host. The calls are
 * async so a refused server is a rejected promise, as a failed IPC call is.
 */
function webProviderAdmin(
  request: (serverId?: string) => TeamApiRequest,
  runtimeRoutes: () => ProviderRuntimeRoutes,
  signInRoutes: () => ProviderCodeLoginRoutes,
  keyRoutes: () => typeof PROVIDERS_ADMIN_ROUTES | typeof PROVIDERS_V5_ROUTES | typeof PROVIDERS_V8_ROUTES,
  customRoutes: () => CustomProviderRoutes,
  accountRelay: () => ProviderAccountRelay | null,
  /** Whether the host has `provider-account-models-v1`. */
  accountModels: () => boolean,
  /** Whether the host has `provider-account-pool-v1`. */
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
      // A host without `custom-provider-edit-v1` has no edit route, and the page offers no Edit.
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

/**
 * The custom ACP agents of the connected host, for an owner or admin, through `custom-agents-v1`. The
 * contract has no trial start and no usage answers, as on the desktop.
 */
function webCustomAgentsApi(request: (serverId?: string) => TeamApiRequest, serverId: string): CustomAgentsEndpointApi {
  return {
    list: async () => runTeamEffect(listCustomAgents(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
    save: async (input) =>
      runTeamEffect(saveCustomAgent(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    delete: async ({ id }) =>
      runTeamEffect(deleteCustomAgent(request(serverId), id).pipe(Effect.mapError((error) => error.cause))),
  };
}

/** The scans and the detection settings of the connected host, through `provider-detection-v1`. */
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
  /** The host's browser, which shows a provider's sign-in page that the host opened. */
  browser: BrowserViewRuntime;
  /** The host's agents, for the agents that use each account. */
  agents: () => readonly AgentProfile[];
}

/**
 * The Providers section of the connected host, for an owner or admin whose host serves
 * `providers-v1`. Keys go to the host and stay in the dialog input on this side; only their state
 * comes back.
 */
export function createWebProviderSettings(options: WebProviderSettingsOptions) {
  const accountRelayOfServer = () =>
    providerAccountRelay((capability) => serverSupportsCapability(options.server(), capability));
  // `request` refuses a server other than the connected one, so the connected one decides the routes.
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
    // `providers-v1` signs in Codex only; the picker offers no other provider on such a host.
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
      serverSupportsCapability(options.server(), CUSTOM_PROVIDER_EDIT_CAPABILITY)
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
    },
  );
  // A boolean, so that a server-list update that keeps the capability does not read the list again.
  const editsCustomProviders = createMemo(() =>
    serverSupportsCapability(options.server(), CUSTOM_PROVIDER_EDIT_CAPABILITY),
  );
  // One store for each host: a list read or changed on the previous host stays in its own store, so
  // it is never shown next to a Delete that goes to this one. The list is read again when the edit
  // capability arrives: only the `custom-provider-edit-v1` list has the header names that Edit needs.
  const customProviders = createMemo(() => {
    const id = serverId();
    editsCustomProviders();
    if (!id) return undefined;
    const store = createCustomProvidersStore(() => hostCustomProvidersApi(() => admin, id));
    // As in the desktop app: a failure leaves the list empty, and nothing retries it from here.
    void store.refreshCustomProviders().catch(() => undefined);
    return store;
  });
  // A boolean, so that a server-list update that keeps the capability does not rebuild the keys.
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
        // The host downloads Pi for the key when it has none, and sends no event for it.
        if (isKeyOnlyProvider(input.provider)) runtimes.refreshProviderRuntimes();
        return result;
      },
    };
  });
  // The released status and agent routes carry no account, so `provider-accounts-v1` adds them.
  const accountsServerId = createMemo(() => remoteAdminServer(options.server(), PROVIDER_ACCOUNTS_CAPABILITY)?.id);
  const hostAccounts = createHostAccounts({
    serverId: accountsServerId,
    accounts: (id) => admin.accounts(id),
    usage: (id) => admin.accountUsage(id),
  });
  const status = createMemo(() => withHostAccounts(options.status(), hostAccounts.host()));
  // As on desktop: the released status routes leave out `off`, so `provider-use-v1` reads the off providers.
  const providerUseServerId = createMemo(() => remoteAdminServer(options.server(), PROVIDER_USE_CAPABILITY)?.id);
  const [providerUse, setProviderUse] = createSignal<{ serverId: string; off: AgentProviderId[] }>();
  /** Changes on each read and switch, so an older answer does not replace a newer list. */
  let providerUseVersion = 0;
  /** Another admin can change the list, so the Providers section reads it each time it is shown. */
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
  // A failure shows each provider as on until the next read.
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
    // The web client is served by the site that has the download page.
    openAppDownload: () => void window.open("/download", "_blank", "noopener"),
  });
  /** As on desktop: the accounts are read again when an account sign-in ends. */
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
  /** As on desktop: the other relay requests run an account's relayed sign-in by its provider. */
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
      // The host runs one account sign-in for each provider, so the released cancel names only the provider.
      cancel: async (provider) => {
        await accountSignIn(id).cancel(provider);
      },
      rename: (provider, accountId, label) => changed(admin.renameAccount({ provider, accountId, label }, id)),
      remove: (provider, accountId) => changed(admin.removeAccount({ provider, accountId }, id)),
      ...(remoteAdminServer(options.server(), PROVIDER_USAGE_RESET_CAPABILITY)?.id === id
        ? {
            usageResets: (provider: AgentProviderId) => admin.usageResets(provider, id),
            resetUsage: async (provider: AgentProviderId, accountId: string) => {
              const outcome = await admin.resetUsage({ provider, accountId }, id);
              // The host sends the reading of its own sign-in; the accounts after the first are read here.
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
      ...(remoteAdminServer(options.server(), PROVIDER_ACCOUNT_KEYS_CAPABILITY)?.id === id
        ? {
            connectKey: (provider: AgentProviderId, accountId: string | null, key: string) =>
              changed(admin.connectAccountKey({ provider, accountId, key }, id)),
          }
        : {}),
    };
  });
  // The host sends status events, but a browser that reconnects in the middle can miss the one that
  // ends the sign-in. The status is read again while the code is on screen.
  createEffect(
    () => connection.provider() !== null && connection.state().phase !== "starting",
    (waiting) => {
      if (!waiting) return;
      const host = serverId();
      const timer = window.setInterval(() => {
        // An answer that arrives after a switch to another server describes the wrong computer.
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
  // One store for each host, as for the endpoints. The host runs each command on its own computer, and
  // the section offers no restart of the host's providers, as on the desktop.
  const customAgentsServerId = createMemo(() => remoteAdminServer(options.server(), CUSTOM_AGENTS_CAPABILITY)?.id);
  const customAgentsStore = createMemo(() => {
    const id = customAgentsServerId();
    if (!id) return undefined;
    const store = createCustomAgentsStore(() => webCustomAgentsApi(options.request, id));
    // As in the desktop app: a failure leaves the list empty.
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
  /**
   * What the host finds on its own computer, as on the desktop. A found row saves to the host's
   * endpoints and custom agents, so the store needs both stores of this host. The host's agents have
   * no trial start, so the form has no Check.
   */
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
    // As in the desktop app: an edit from a list with no header names would delete the saved headers.
    get onUpdateCustomProvider() {
      const editable =
        editsCustomProviders() &&
        (customProviders()?.customProviders() ?? []).every((provider) => provider.headerNames !== undefined);
      return editable ? updateEndpoint : undefined;
    },
    get providerKeys() {
      return providerKeys();
    },
    // The host's agents need its capabilities, which can arrive after the section opens.
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
    /** The host's Default provider, which the Providers section reads beside `settings`. */
    hostDefaultProviderCalls: admin,
    /** The status with the host's accounts, for the model picker and the dock. */
    status,
    hostAccounts,
  };
}

import type {
  AgentProviderId,
  AgentStatus,
  ExternalDestination,
  ProviderAdminDesktopApi,
  ServerSummary,
} from "@openbot/contracts/ipc";
import { decodeRegistryEntries, decodeRegistryInstallResult, decodeRegistryOperations } from "@openbot/contracts/ipc";
import { ACP_REGISTRY_ROUTES } from "@openbot/contracts/team-protocol/acp-registry-v1";
import { CLAUDE_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import {
  type ProviderAccountRelay,
  providerAccountRelay,
} from "@openbot/contracts/team-protocol/provider-account-relays";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDER_SIGN_OUT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
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
  cancelProviderAccountSignIn,
  cancelProviderCodeLogin,
  cancelProviderHostSignIn,
  cancelProviderRuntime,
  checkProviderRuntimeUpdates,
  clearProviderApiKey,
  deleteCustomProvider,
  downloadProviderRuntime,
  getProviderApiKeyState,
  getProviderRuntimes,
  listCustomProviders,
  listProviderAccounts,
  type ProviderCodeLoginRoutes,
  type ProviderRuntimeRoutes,
  providerAccountSignInStatus,
  providerAccountUsage,
  providerHostSignInStatus,
  providerUsageResets,
  removeProviderAccount,
  renameProviderAccount,
  resetProviderUsage,
  saveCustomProvider,
  setProviderApiKey,
  signOutProvider,
  startProviderAccountSignIn,
  startProviderCodeLogin,
  startProviderHostSignIn,
  submitProviderCodeLogin,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import type { ProviderAccountActions } from "@openbot/ui/components/provider-accounts";
import { isAgentAccount } from "@openbot/ui/components/provider-accounts";
import type { AgentProfile } from "@openbot/ui/data";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import type { AcpRegistrySettingsApi } from "@openbot/ui/features/custom-providers/AcpRegistrySettings";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { createEffect, createMemo } from "solid-js";
import { createHostAccounts, withHostAccounts, withHostProfileAccount } from "../agents/host-provider-accounts";
import { hostCustomProvidersApi } from "../custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "../custom-providers/stores/custom-providers-store";
import { createProviderConnection } from "../provider-updates/provider-connection";
import { createProviderRuntimeStore } from "../provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "../provider-updates/remote-provider-runtimes";
import { remoteAdminServer, serverSupportsCapability } from "../servers/server-capabilities";
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

/**
 * The desktop `providerAdmin` group, answered over the Team API of the connected host. The calls are
 * async so a refused server is a rejected promise, as a failed IPC call is.
 */
function webProviderAdmin(
  request: (serverId?: string) => TeamApiRequest,
  runtimeRoutes: () => ProviderRuntimeRoutes,
  signInRoutes: () => ProviderCodeLoginRoutes,
  keyRoutes: () => typeof PROVIDERS_ADMIN_ROUTES | typeof PROVIDERS_V5_ROUTES | typeof PROVIDERS_V8_ROUTES,
  accountRelay: () => ProviderAccountRelay | null,
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
      runTeamEffect(listCustomProviders(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
    saveCustomProvider: async (input, serverId) =>
      runTeamEffect(saveCustomProvider(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    deleteCustomProvider: async (input, serverId) =>
      runTeamEffect(deleteCustomProvider(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    accounts: async (serverId) =>
      runTeamEffect(listProviderAccounts(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
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
    renameAccount: async (input, serverId) =>
      runTeamEffect(renameProviderAccount(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    removeAccount: async (input, serverId) =>
      runTeamEffect(removeProviderAccount(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    usageResets: async (provider, serverId) =>
      runTeamEffect(providerUsageResets(request(serverId), provider).pipe(Effect.mapError((error) => error.cause))),
    resetUsage: async (input, serverId) =>
      runTeamEffect(resetProviderUsage(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    signOut: async (provider, serverId) =>
      runTeamEffect(signOutProvider(request(serverId), provider).pipe(Effect.mapError((error) => error.cause))),
    ...webProviderRelay(request, accountRelay),
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
    accountRelayOfServer,
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
  // One store for each host: a list read or changed on the previous host stays in its own store, so
  // it is never shown next to a Delete that goes to this one.
  const customProviders = createMemo(() => {
    const id = serverId();
    if (!id) return undefined;
    const store = createCustomProvidersStore(() => hostCustomProvidersApi(() => admin, id));
    // As in the desktop app: a failure leaves the list empty, and nothing retries it from here.
    void store.refreshCustomProviders().catch(() => undefined);
    return store;
  });
  // A boolean, so that a server-list update that keeps the capability does not rebuild the keys.
  const readsClaudeKey = createMemo(() => serverSupportsCapability(options.server(), CLAUDE_API_KEY_CAPABILITY));
  const providerKeys = createMemo(() => {
    const id = serverId();
    return id
      ? {
          ...hostProviderKeyApi(() => admin, id, openWebDestination),
          readsClaudeKey: readsClaudeKey(),
        }
      : undefined;
  });
  // The released status and agent routes carry no account, so `provider-accounts-v1` adds them.
  const accountsServerId = createMemo(() => remoteAdminServer(options.server(), PROVIDER_ACCOUNTS_CAPABILITY)?.id);
  const hostAccounts = createHostAccounts({
    serverId: accountsServerId,
    accounts: (id) => admin.accounts(id),
    usage: (id) => admin.accountUsage(id),
  });
  const status = createMemo(() => withHostAccounts(options.status(), hostAccounts.host()));
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
    get providerKeys() {
      return providerKeys();
    },
    connection,
  };
  return {
    settings: (): HostProviderSettings | undefined => (serverId() ? settings : undefined),
    /** The status with the host's accounts, for the model picker and the dock. */
    status,
    hostAccounts,
  };
}

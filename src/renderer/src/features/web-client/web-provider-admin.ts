import type {
  AgentProviderId,
  AgentStatus,
  ExternalDestination,
  ProviderAdminDesktopApi,
  ServerSummary,
} from "@openbot/contracts/ipc";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import {
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v2";
import {
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v3";
import { runTeamEffect } from "@openbot/team-client";
import {
  cancelProviderCodeLogin,
  cancelProviderRuntime,
  checkProviderRuntimeUpdates,
  clearProviderApiKey,
  deleteCustomProvider,
  downloadProviderRuntime,
  getProviderApiKeyState,
  getProviderRuntimes,
  listCustomProviders,
  type ProviderCodeLoginRoutes,
  type ProviderRuntimeRoutes,
  saveCustomProvider,
  setProviderApiKey,
  startProviderCodeLogin,
  submitProviderCodeLogin,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { createEffect, createMemo } from "solid-js";
import { hostCustomProvidersApi } from "../custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "../custom-providers/stores/custom-providers-store";
import { createProviderCodeLogin } from "../provider-updates/provider-code-login";
import { createProviderRuntimeStore } from "../provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "../provider-updates/remote-provider-runtimes";
import { codeSignInProviders, remoteAdminServer, serverSupportsCapability } from "../servers/server-capabilities";
import type { HostProviderSettings } from "../settings/ProviderSettingsSection";
import { hostProviderKeyApi } from "../settings/provider-key-api";

/** How often the host status is read while a code sign-in waits, in case a status event is lost. */
const CODE_LOGIN_POLL_MS = 3000;

/**
 * The pages the key dialog and the account menu link to. The desktop app keeps its table in main; the
 * browser has no main process, so the pages it opens are listed here, and any other name is refused.
 */
const WEB_EXTERNAL_DESTINATIONS: Partial<Record<ExternalDestination, string>> = {
  "opencode-auth": "https://opencode.ai/auth",
  feedback: "https://x.com/intent/post?text=Feedback%20for%20OpenBot%20%40norbertbodziony%3A%20",
  message: "https://x.com/norbertbodziony",
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
): ProviderAdminDesktopApi {
  return {
    startCodeLogin: async (provider, serverId) =>
      runTeamEffect(
        startProviderCodeLogin(request(serverId), provider, signInRoutes()).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    submitCodeLogin: async (input, serverId) =>
      runTeamEffect(submitProviderCodeLogin(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    cancelCodeLogin: async (provider, serverId) =>
      runTeamEffect(
        cancelProviderCodeLogin(request(serverId), provider, signInRoutes()).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    getApiKeyState: async (provider, serverId) =>
      runTeamEffect(getProviderApiKeyState(request(serverId), provider).pipe(Effect.mapError((error) => error.cause))),
    setApiKey: async (input, serverId) =>
      runTeamEffect(setProviderApiKey(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    clearApiKey: async (provider, serverId) =>
      runTeamEffect(clearProviderApiKey(request(serverId), provider).pipe(Effect.mapError((error) => error.cause))),
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
  };
}

export interface WebProviderSettingsOptions {
  server: () => ServerSummary | undefined;
  request: (serverId?: string) => TeamApiRequest;
  status: () => AgentStatus;
  setStatus: (status: AgentStatus) => void;
  readStatus: () => Promise<AgentStatus>;
}

/**
 * The Providers section of the connected host, for an owner or admin whose host serves
 * `providers-v1`. Keys go to the host and stay in the dialog input on this side; only their state
 * comes back.
 */
export function createWebProviderSettings(options: WebProviderSettingsOptions): () => HostProviderSettings | undefined {
  // `request` refuses a server other than the connected one, so the connected one decides the routes.
  const admin = webProviderAdmin(
    options.request,
    () =>
      serverSupportsCapability(options.server(), PROVIDERS_RUNTIMES_V2_CAPABILITY)
        ? PROVIDERS_RUNTIMES_V2_ROUTES
        : PROVIDERS_ADMIN_ROUTES,
    // `providers-v1` signs in Codex only; the picker offers no other provider on such a host.
    () =>
      serverSupportsCapability(options.server(), PROVIDERS_SIGN_IN_V3_CAPABILITY)
        ? PROVIDERS_SIGN_IN_V3_ROUTES
        : PROVIDERS_ADMIN_ROUTES,
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
  const providerKeys = createMemo(() => {
    const id = serverId();
    return id ? hostProviderKeyApi(() => admin, id, openWebDestination) : undefined;
  });
  const codeLogin = createProviderCodeLogin({
    agentStatus: options.status,
    applyStatus: options.setStatus,
    target: () => {
      const id = serverId();
      return {
        start: (provider: AgentProviderId) => admin.startCodeLogin(provider, id ?? ""),
        submit: (provider: AgentProviderId, code: string) => admin.submitCodeLogin({ provider, code }, id ?? ""),
        cancel: (provider: AgentProviderId) => admin.cancelCodeLogin(provider, id ?? ""),
      };
    },
    providers: () => codeSignInProviders(options.server()),
    openVerificationUrl: (url) => void window.open(url, "_blank", "noopener"),
  });
  // The host sends status events, but a browser that reconnects in the middle can miss the one that
  // ends the sign-in. The status is read again while the code is on screen.
  createEffect(
    () => codeLogin.provider() !== null && codeLogin.state().phase !== "starting",
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

  const settings: HostProviderSettings = {
    get agentStatus() {
      return options.status();
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
    codeLogin,
  };
  return () => (serverId() ? settings : undefined);
}

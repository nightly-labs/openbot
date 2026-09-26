import type {
  AgentProviderId,
  AgentStatus,
  ExternalDestination,
  ProviderAdminDesktopApi,
  ServerSummary,
} from "@openbot/contracts/ipc";
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
  saveCustomProvider,
  setProviderApiKey,
  startProviderCodeLogin,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { createEffect, createMemo } from "solid-js";
import { hostCustomProvidersApi } from "../custom-providers/custom-providers-port";
import { createCustomProvidersStore } from "../custom-providers/stores/custom-providers-store";
import { createProviderCodeLogin } from "../provider-updates/provider-code-login";
import { createProviderRuntimeStore } from "../provider-updates/provider-runtime-store";
import { remoteProviderRuntimes } from "../provider-updates/remote-provider-runtimes";
import { remoteAdminServer } from "../servers/server-capabilities";
import type { HostProviderSettings } from "../settings/ProviderSettingsSection";
import { hostProviderKeyApi } from "../settings/provider-key-api";

/** How often the host status is read while a code sign-in waits, in case a status event is lost. */
const CODE_LOGIN_POLL_MS = 3000;

/**
 * The pages the key dialog links to. The desktop app keeps its table in main; the browser has no
 * main process, so the one page the dialog opens is listed here, and any other name is refused.
 */
const WEB_EXTERNAL_DESTINATIONS: Partial<Record<ExternalDestination, string>> = {
  "opencode-auth": "https://opencode.ai/auth",
};

function openWebDestination(destination: ExternalDestination): Promise<void> {
  const url = WEB_EXTERNAL_DESTINATIONS[destination];
  if (!url) return Promise.reject(new Error("This link opens only in the desktop app."));
  window.open(url, "_blank", "noopener");
  return Promise.resolve();
}

/**
 * The desktop `providerAdmin` group, answered over the Team API of the connected host. The calls are
 * async so a refused server is a rejected promise, as a failed IPC call is.
 */
function webProviderAdmin(request: (serverId?: string) => TeamApiRequest): ProviderAdminDesktopApi {
  return {
    startCodeLogin: async (provider, serverId) => startProviderCodeLogin(request(serverId), provider),
    cancelCodeLogin: async (provider, serverId) => cancelProviderCodeLogin(request(serverId), provider),
    getApiKeyState: async (provider, serverId) => getProviderApiKeyState(request(serverId), provider),
    setApiKey: async (input, serverId) => setProviderApiKey(request(serverId), input),
    clearApiKey: async (provider, serverId) => clearProviderApiKey(request(serverId), provider),
    getRuntimes: async (serverId) => getProviderRuntimes(request(serverId)),
    downloadRuntime: async (provider, serverId) => downloadProviderRuntime(request(serverId), provider),
    cancelRuntime: async (provider, serverId) => cancelProviderRuntime(request(serverId), provider),
    checkRuntimeUpdates: async (serverId) => checkProviderRuntimeUpdates(request(serverId)),
    listCustomProviders: async (serverId) => listCustomProviders(request(serverId)),
    saveCustomProvider: async (input, serverId) => saveCustomProvider(request(serverId), input),
    deleteCustomProvider: async (input, serverId) => deleteCustomProvider(request(serverId), input),
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
  const admin = webProviderAdmin(options.request);
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
        cancel: (provider: AgentProviderId) => admin.cancelCodeLogin(provider, id ?? ""),
      };
    },
    openVerificationUrl: (url) => void window.open(url, "_blank", "noopener"),
  });
  // The host sends status events, but a browser that reconnects in the middle can miss the one that
  // ends the sign-in. The status is read again while the code is on screen.
  createEffect(
    () => codeLogin.provider() !== null && codeLogin.state().phase === "waiting",
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
      if (!store) throw new Error("Connect to your host to save an endpoint.");
      return store.saveCustomProvider(value);
    },
    onDeleteCustomProvider: async (id) => {
      const store = customProviders();
      if (!store) throw new Error("Connect to your host to remove an endpoint.");
      return store.deleteCustomProvider(id);
    },
    get providerKeys() {
      return providerKeys();
    },
    codeLogin,
  };
  return () => (serverId() ? settings : undefined);
}

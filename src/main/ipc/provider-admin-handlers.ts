// The providers of one server's host: code sign-in, API keys, managed CLI runtimes and custom
// endpoints. On a joined server they belong to the host, so the request goes there, and the host
// answers only an owner or admin. A key only travels towards the host; no result carries one.

import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import {
  type AgentStatus,
  type CustomProviderResult,
  type CustomProviderSummary,
  isCustomProviderResult,
  isCustomProviderSummary,
  type ProviderApiKeyStatus,
  type ProviderCodeLoginStart,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { PROVIDERS_ADMIN_CAPABILITY, PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../../backend/agent-service";
import type { CustomProviderChanges } from "../custom-provider-changes";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import { decodeAgentStatusFromHost } from "../remote-agent-decoding";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { parseProviderId } from "./app-inputs";
import { parseDeleteCustomProvider, parseSaveCustomProvider } from "./custom-provider-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { parseManagedProviderId, parseProviderApiKeyInput } from "./provider-handlers";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

interface ProviderAdminRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit): Promise<T>;
}

interface ProviderAdminIpcDependencies {
  service: Pick<AgentService, "startProviderCodeLogin" | "cancelProviderCodeLogin" | "changeProviderCredential">;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<ProviderRuntimeManager, "getStatus" | "download" | "cancel" | "checkForUpdates">;
  customProviders: CustomProviderChanges;
  remoteServers: ProviderAdminRemoteServers;
}

// The providers-v1 codec has already checked the fields of every reply below.
const acceptEmpty = (): undefined => undefined;

/** The verification URL becomes a link the admin opens, so it is held to https here as well. */
function decodeRemoteCodeLogin(value: unknown): ProviderCodeLoginStart {
  if (!isDynamicRecord(value)) throw new Error("Invalid code login.");
  if (value.kind === "connected") return { kind: "connected" };
  if (!isString(value.userCode) || !isString(value.verificationUrl) || !isNumber(value.expiresAt))
    throw new Error("Invalid code login.");
  if (new URL(value.verificationUrl).protocol !== "https:") throw new Error("Invalid code login.");
  return { kind: "code", userCode: value.userCode, verificationUrl: value.verificationUrl, expiresAt: value.expiresAt };
}

function decodeRemoteKeyStatus(value: unknown): ProviderApiKeyStatus {
  if (!isDynamicRecord(value) || !isOneOf(["missing", "saved", "unreadable"] as const, value.status))
    throw new Error("Invalid provider key state.");
  return value.status;
}

function decodeRemoteRuntimeStatus(value: unknown): ProviderRuntimeStatus {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(["not-downloaded", "downloading", "finishing", "ready", "download-error"] as const, value.phase) ||
    (value.progress !== null && !isNumber(value.progress)) ||
    (value.message !== null && !isString(value.message)) ||
    (value.version !== null && !isString(value.version)) ||
    (value.availableVersion !== undefined && value.availableVersion !== null && !isString(value.availableVersion))
  ) {
    throw new Error("Invalid provider runtime.");
  }
  return {
    phase: value.phase,
    progress: value.progress,
    message: value.message,
    version: value.version,
    availableVersion: value.availableVersion ?? null,
  };
}

function decodeRemoteRuntimes(value: unknown): ProviderRuntimeSnapshot {
  if (
    !isDynamicRecord(value) ||
    !isNumber(value.revision) ||
    !isDynamicRecord(value.providers) ||
    !isDynamicRecord(value.toolRuntimes)
  ) {
    throw new Error("Invalid provider runtimes.");
  }
  const { providers, toolRuntimes } = value;
  return {
    revision: value.revision,
    providers: {
      codex: decodeRemoteRuntimeStatus(providers.codex),
      claude: decodeRemoteRuntimeStatus(providers.claude),
      grok: decodeRemoteRuntimeStatus(providers.grok),
      opencode: decodeRemoteRuntimeStatus(providers.opencode),
    },
    toolRuntimes: { bun: decodeRemoteRuntimeStatus(toolRuntimes.bun) },
  };
}

// The contract guard asserts that a summary carries no key, and fails closed on the whole list.
function decodeRemoteCustomProviders(value: unknown): CustomProviderSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomProviderSummary)) throw new Error("Invalid custom providers.");
  return value;
}

function decodeRemoteCustomProviderResult(value: unknown): CustomProviderResult {
  if (!isCustomProviderResult(value)) throw new Error("Invalid custom provider result.");
  return value;
}

export function providerAdminIpcHandlers({
  service,
  credentials,
  runtimes,
  customProviders,
  remoteServers,
}: ProviderAdminIpcDependencies): Pick<IpcGroupHandlers, "providerAdmin"> {
  function remote<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, PROVIDERS_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.provider.localOnly"));
    return remoteServers.request(serverId, path, decoder, { method: "POST", body });
  }

  /** A change, then the host's status, so the result is the same `AgentStatus` the local change gives. */
  async function remoteChange(serverId: string, path: string, body: unknown): Promise<AgentStatus> {
    await remote(serverId, path, body, acceptEmpty);
    return remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost);
  }

  const runtime = (path: string) => (provider: ManagedProviderId, serverId: string) =>
    remote(serverId, path, { provider }, decodeRemoteRuntimes);

  return {
    providerAdmin: {
      startCodeLogin: scopedHandler(parseProviderId, {
        local: (provider) => service.startProviderCodeLogin(provider),
        remote: (provider, serverId) =>
          remote(serverId, PROVIDERS_ADMIN_ROUTES.codeLoginStart, { provider }, decodeRemoteCodeLogin),
      }),
      cancelCodeLogin: scopedHandler(parseProviderId, {
        local: (provider) => service.cancelProviderCodeLogin(provider),
        remote: (provider, serverId) => remoteChange(serverId, PROVIDERS_ADMIN_ROUTES.codeLoginCancel, { provider }),
      }),
      getApiKeyState: scopedHandler(parseProviderId, {
        local: (provider) => ({ provider, status: credentials.status(provider) }),
        remote: async (provider, serverId) => ({
          provider,
          status: await remote(serverId, PROVIDERS_ADMIN_ROUTES.apiKeyState, { provider }, decodeRemoteKeyStatus),
        }),
      }),
      setApiKey: scopedHandler(parseProviderApiKeyInput, {
        local: ({ provider, key }) => service.changeProviderCredential(provider, () => credentials.set(provider, key)),
        remote: (input, serverId) => remoteChange(serverId, PROVIDERS_ADMIN_ROUTES.apiKeySet, input),
      }),
      clearApiKey: scopedHandler(parseProviderId, {
        local: (provider) => service.changeProviderCredential(provider, () => credentials.clear(provider)),
        remote: (provider, serverId) => remoteChange(serverId, PROVIDERS_ADMIN_ROUTES.apiKeyClear, { provider }),
      }),
      getRuntimes: scopedQueryHandler({
        local: () => runtimes.getStatus(),
        remote: (serverId) => remote(serverId, PROVIDERS_ADMIN_ROUTES.runtimesStatus, {}, decodeRemoteRuntimes),
      }),
      downloadRuntime: scopedHandler(parseManagedProviderId, {
        local: (provider) => runtimes.download(provider),
        remote: runtime(PROVIDERS_ADMIN_ROUTES.runtimesDownload),
      }),
      cancelRuntime: scopedHandler(parseManagedProviderId, {
        local: (provider) => runtimes.cancel(provider),
        remote: runtime(PROVIDERS_ADMIN_ROUTES.runtimesCancel),
      }),
      checkRuntimeUpdates: scopedQueryHandler({
        local: () => runtimes.checkForUpdates(),
        remote: (serverId) => remote(serverId, PROVIDERS_ADMIN_ROUTES.runtimesCheck, {}, decodeRemoteRuntimes),
      }),
      listCustomProviders: scopedQueryHandler({
        local: () => customProviders.list(),
        remote: (serverId) => remote(serverId, PROVIDERS_ADMIN_ROUTES.customList, {}, decodeRemoteCustomProviders),
      }),
      saveCustomProvider: scopedHandler(parseSaveCustomProvider, {
        local: (input) => customProviders.save(input),
        remote: (input, serverId) =>
          remote(serverId, PROVIDERS_ADMIN_ROUTES.customSave, input, decodeRemoteCustomProviderResult),
      }),
      deleteCustomProvider: scopedHandler(parseDeleteCustomProvider, {
        local: ({ id }) => customProviders.remove(id),
        remote: (input, serverId) =>
          remote(serverId, PROVIDERS_ADMIN_ROUTES.customDelete, input, decodeRemoteCustomProviderResult),
      }),
    },
  };
}

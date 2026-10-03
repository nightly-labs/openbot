import { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// The providers of one server's host: code sign-in, API keys, managed CLI runtimes and custom
// endpoints. On a joined server they belong to the host, so the request goes there, and the host
// answers only an owner or admin. A key only travels towards the host; no result carries one.

import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import {
  type AgentProviderId,
  type AgentStatus,
  decodeCustomProviderResult,
  decodeCustomProviderSummaries,
  decodeProviderApiKeyStatus,
  decodeProviderCodeLoginStart,
  decodeProviderRuntimeSnapshot,
  type SubmitProviderCodeLoginInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { PROVIDERS_ADMIN_CAPABILITY, PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import {
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v2";
import {
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v3";
import { sourceText } from "@openbot/i18n/source";
import { normalizePastedCode } from "../../backend/agent/cli-code-login";
import { AgentLifecycleFailed, type AgentService } from "../../backend/agent-service";
import type { PeerCustomProviderChanges } from "../custom-provider-changes";
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
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

interface ProviderAdminIpcDependencies {
  service: Pick<
    AgentService,
    "startProviderCodeLogin" | "submitProviderCodeLogin" | "cancelProviderCodeLogin" | "changeProviderCredential"
  >;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<ProviderRuntimeManager, "getStatus" | "download" | "cancel" | "checkForUpdates">;
  customProviders: PeerCustomProviderChanges;
  remoteServers: ProviderAdminRemoteServers;
}

// The providers-v1 codec has already checked the fields of every reply below.
const acceptEmpty = (): undefined => undefined;

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
    return Effect.runPromise(
      remoteServers
        .request(serverId, path, decoder, { method: "POST", body })
        .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
    );
  }

  /** A change, then the host's status, so the result is the same `AgentStatus` the local change gives. */
  async function remoteChange(serverId: string, path: string, body: unknown): Promise<AgentStatus> {
    await remote(serverId, path, body, acceptEmpty);
    return Effect.runPromise(
      remoteServers
        .request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost)
        .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
    );
  }

  /** The runtime routes of the host: `providers-v2` includes Gemini, and `providers-v1` does not. */
  function runtimeRoutes(serverId: string) {
    return remoteServers.supportsCapability(serverId, PROVIDERS_RUNTIMES_V2_CAPABILITY)
      ? PROVIDERS_RUNTIMES_V2_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  }

  /**
   * The sign-in routes of the host: `providers-v3` signs in Codex, Claude and Grok. An older host
   * has `providers-v1` only, which signs in Codex, so another provider is refused here and not by
   * the host.
   */
  function signInRoutes(serverId: string, provider: AgentProviderId) {
    if (remoteServers.supportsCapability(serverId, PROVIDERS_SIGN_IN_V3_CAPABILITY)) return PROVIDERS_SIGN_IN_V3_ROUTES;
    if (provider !== "codex") throw new Error(sourceText("error.provider.localOnly"));
    return PROVIDERS_ADMIN_ROUTES;
  }

  const runtime = (route: "runtimesDownload" | "runtimesCancel") => (provider: ManagedProviderId, serverId: string) =>
    remote(serverId, runtimeRoutes(serverId)[route], { provider }, decodeProviderRuntimeSnapshot);

  return {
    providerAdmin: {
      startCodeLogin: scopedHandler(parseProviderId, {
        local: (provider) =>
          Effect.runPromise(service.startProviderCodeLogin(provider).pipe(Effect.mapError((error) => error.cause))),
        remote: (provider, serverId) =>
          remote(serverId, signInRoutes(serverId, provider).codeLoginStart, { provider }, decodeProviderCodeLoginStart),
      }),
      submitCodeLogin: scopedHandler(parseSubmitCodeLoginInput, {
        local: ({ provider, code }) => service.submitProviderCodeLogin(provider, code),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, PROVIDERS_SIGN_IN_V3_CAPABILITY))
            throw new Error(sourceText("error.provider.localOnly"));
          return remoteChange(serverId, PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginSubmit, input);
        },
      }),
      cancelCodeLogin: scopedHandler(parseProviderId, {
        local: (provider) =>
          Effect.runPromise(service.cancelProviderCodeLogin(provider).pipe(Effect.mapError((error) => error.cause))),
        remote: (provider, serverId) =>
          remoteChange(serverId, signInRoutes(serverId, provider).codeLoginCancel, { provider }),
      }),
      getApiKeyState: scopedHandler(parseProviderId, {
        local: (provider) => ({ provider, status: credentials.status(provider) }),
        remote: async (provider, serverId) => ({
          provider,
          status: await remote(serverId, PROVIDERS_ADMIN_ROUTES.apiKeyState, { provider }, decodeProviderApiKeyStatus),
        }),
      }),
      setApiKey: scopedHandler(parseProviderApiKeyInput, {
        local: ({ provider, key }) =>
          Effect.runPromise(
            service
              .changeProviderCredential(provider, () =>
                credentials
                  .set(provider, key)
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                    ),
                  ),
              )
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (input, serverId) => remoteChange(serverId, PROVIDERS_ADMIN_ROUTES.apiKeySet, input),
      }),
      clearApiKey: scopedHandler(parseProviderId, {
        local: (provider) =>
          Effect.runPromise(
            service
              .changeProviderCredential(provider, () =>
                credentials
                  .clear(provider)
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                    ),
                  ),
              )
              .pipe(Effect.mapError((error) => error.cause)),
          ),
        remote: (provider, serverId) => remoteChange(serverId, PROVIDERS_ADMIN_ROUTES.apiKeyClear, { provider }),
      }),
      getRuntimes: scopedQueryHandler({
        local: () => runtimes.getStatus(),
        remote: (serverId) =>
          remote(serverId, runtimeRoutes(serverId).runtimesStatus, {}, decodeProviderRuntimeSnapshot),
      }),
      downloadRuntime: scopedHandler(parseManagedProviderId, {
        local: (provider) =>
          Effect.runPromise(runtimes.download(provider).pipe(Effect.mapError((error) => error.cause))),
        remote: runtime("runtimesDownload"),
      }),
      cancelRuntime: scopedHandler(parseManagedProviderId, {
        local: (provider) => Effect.runPromise(runtimes.cancel(provider).pipe(Effect.mapError((error) => error.cause))),
        remote: runtime("runtimesCancel"),
      }),
      checkRuntimeUpdates: scopedQueryHandler({
        local: () => Effect.runPromise(runtimes.checkForUpdates().pipe(Effect.mapError((error) => error.cause))),
        remote: (serverId) =>
          remote(serverId, runtimeRoutes(serverId).runtimesCheck, {}, decodeProviderRuntimeSnapshot),
      }),
      listCustomProviders: scopedQueryHandler({
        local: () => customProviders.list(),
        remote: (serverId) => remote(serverId, PROVIDERS_ADMIN_ROUTES.customList, {}, decodeCustomProviderSummaries),
      }),
      saveCustomProvider: scopedHandler(parseSaveCustomProvider, {
        local: (input) => Effect.runPromise(customProviders.save(input).pipe(Effect.mapError((error) => error.cause))),
        remote: (input, serverId) =>
          remote(serverId, PROVIDERS_ADMIN_ROUTES.customSave, input, decodeCustomProviderResult),
      }),
      deleteCustomProvider: scopedHandler(parseDeleteCustomProvider, {
        local: ({ id }) => Effect.runPromise(customProviders.remove(id).pipe(Effect.mapError((error) => error.cause))),
        remote: (input, serverId) =>
          remote(serverId, PROVIDERS_ADMIN_ROUTES.customDelete, input, decodeCustomProviderResult),
      }),
    },
  };
}

/** The error never quotes the code, which is a credential. */
function parseSubmitCodeLoginInput(value: unknown): SubmitProviderCodeLoginInput {
  if (!isDynamicRecord(value) || !isString(value.code)) throw new Error(sourceText("error.provider.codeLoginBadCode"));
  return { provider: parseProviderId(value.provider), code: normalizePastedCode(value.code) };
}

import { PROVIDERS_V5_CAPABILITY, PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { Cause, Effect, Exit, Fiber } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// The providers of one server's host: code sign-in, API keys, managed CLI runtimes and custom
// endpoints. On a joined server they belong to the host, so the request goes there, and the host
// answers only an owner or admin. A key only travels towards the host; no result carries one.

import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentProviderId,
  type AgentStatus,
  decodeCustomProviderResult,
  decodeCustomProviderSummaries,
  decodeHostProviderAccountUsage,
  decodeProviderApiKeyStatus,
  decodeProviderCodeLoginStart,
  decodeProviderHostSignInStatus,
  decodeProviderRuntimeSnapshot,
  decodeProviderRuntimeSnapshotV8,
  decodeSignInRelayFlow,
  type McpTestResult,
  type PasteProviderRelaySignInInput,
  type ProviderRelaySignInStatus,
  type SubmitProviderCodeLoginInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { providerAccountRelay } from "@openbot/contracts/team-protocol/provider-account-relays";
import {
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_ACCOUNTS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  PROVIDER_HOST_SIGN_IN_CAPABILITY,
  PROVIDER_HOST_SIGN_IN_ERROR_LIMIT,
  PROVIDER_HOST_SIGN_IN_ROUTES,
} from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import {
  PROVIDER_SIGN_OUT_CAPABILITY,
  PROVIDER_SIGN_OUT_ROUTES,
} from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import {
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDER_USAGE_RESET_ROUTES,
} from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDERS_ADMIN_CAPABILITY, PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import {
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v2";
import {
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v3";
import { PROVIDERS_V4_CAPABILITY, PROVIDERS_V4_ROUTES } from "@openbot/contracts/team-protocol/providers-v4";
import {
  SIGN_IN_RELAY_CAPABILITY,
  SIGN_IN_RELAY_PROVIDERS,
  SIGN_IN_RELAY_ROUTES,
} from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { normalizePastedCode } from "../../backend/agent/cli-code-login";
import { AgentLifecycleFailed, type AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { PeerCustomProviderChanges } from "../custom-provider-changes";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import {
  decodeAgentStatusFromHost,
  decodeHostProviderAccountsFromHost,
  decodeProviderUsageResetOutcomeFromHost,
  decodeProviderUsageResetsFromHost,
} from "../remote-agent-decoding";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { type SignInRelayClient, signInRelayRemote } from "../sign-in-relay-client";
import { parseProviderId } from "./app-inputs";
import { parseDeleteCustomProvider, parseSaveCustomProvider } from "./custom-provider-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import {
  parseConnectProviderAccountInput,
  parseManagedProviderId,
  parseProviderApiKeyInput,
  parseRemoveProviderAccountInput,
  parseRenameProviderAccountInput,
  parseResetProviderUsageInput,
  signInCodexWithApiKey,
} from "./provider-handlers";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { isObject, requireString } from "./validation";

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
    | "startProviderCodeLogin"
    | "submitProviderCodeLogin"
    | "cancelProviderCodeLogin"
    | "changeProviderCredential"
    | "clearProviderCredential"
    | "signInCodexWithApiKey"
  >;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<
    ProviderRuntimeManager,
    "getStatus" | "download" | "cancel" | "checkForUpdates" | "ensureKeyProviderCli"
  >;
  customProviders: PeerCustomProviderChanges;
  remoteServers: ProviderAdminRemoteServers;
  /** Opens the page of a joined server's sign-in in this computer's browser, and relays the callback. */
  relay: Pick<SignInRelayClient, "run" | "page" | "open" | "paste">;
}

/** A relayed sign-in that runs on this computer, and how it ended once it did. */
interface RelayedSignIn {
  fiber: Fiber.Fiber<McpTestResult, unknown>;
  result: { error: string | null } | null;
}

export function providerAdminIpcHandlers({
  service,
  credentials,
  runtimes,
  customProviders,
  remoteServers,
  relay,
}: ProviderAdminIpcDependencies): Pick<IpcGroupHandlers, "providerAdmin"> {
  function remote<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, PROVIDERS_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.provider.localOnly"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  /** A change, then the host's status, so the result is the same `AgentStatus` the local change gives. */
  async function remoteChange(serverId: string, path: string, body: unknown): Promise<AgentStatus> {
    await remote(serverId, path, body, acceptEmpty);
    return runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost));
  }

  /**
   * The runtime routes of the host: `providers-v8` names any provider, `providers-v4` includes Cursor
   * and Cline, `providers-v2` Gemini, and `providers-v1` none of them.
   */
  function keyRoutes(serverId: string) {
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)) return PROVIDERS_V8_ROUTES;
    return remoteServers.supportsCapability(serverId, PROVIDERS_V5_CAPABILITY)
      ? PROVIDERS_V5_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  }
  function runtimeRoutes(serverId: string) {
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)) return PROVIDERS_V8_ROUTES;
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V5_CAPABILITY)) return PROVIDERS_V5_ROUTES;
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V4_CAPABILITY)) return PROVIDERS_V4_ROUTES;
    return remoteServers.supportsCapability(serverId, PROVIDERS_RUNTIMES_V2_CAPABILITY)
      ? PROVIDERS_RUNTIMES_V2_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  }

  /**
   * The sign-in routes of the host: `providers-v8` names any provider, `providers-v4` signs in Codex, Claude, Grok, Cursor and Cline,
   * and `providers-v3` Codex, Claude and Grok. An older host has `providers-v1` only, which signs in
   * Codex, so another provider is refused here and not by the host.
   */
  function signInRoutes(serverId: string, provider: AgentProviderId) {
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)) return PROVIDERS_V8_ROUTES;
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V4_CAPABILITY)) return PROVIDERS_V4_ROUTES;
    if (remoteServers.supportsCapability(serverId, PROVIDERS_SIGN_IN_V3_CAPABILITY)) return PROVIDERS_SIGN_IN_V3_ROUTES;
    if (provider !== "codex") throw new Error(sourceText("error.provider.localOnly"));
    return PROVIDERS_ADMIN_ROUTES;
  }

  /**
   * A sign-in in the browser of a joined server's host, which only a host with
   * `provider-host-sign-in-v1` runs. This computer signs in with its own browser, through Connect.
   */
  const hostSignIn = <T>(run: (provider: AgentProviderId, serverId: string) => Promise<T>) =>
    scopedHandler(parseProviderId, {
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: (provider: AgentProviderId, serverId: string) => {
        if (!remoteServers.supportsCapability(serverId, PROVIDER_HOST_SIGN_IN_CAPABILITY))
          throw new Error(sourceText("error.team.providersUnsupported"));
        return run(provider, serverId);
      },
    });

  /** The accounts of a joined server's host's providers, which only a host with `provider-accounts-v1` holds. */
  function requireAccounts(serverId: string): void {
    if (!remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNTS_CAPABILITY))
      throw new Error(sourceText("error.team.providersUnsupported"));
  }
  const accountsQuery = <T>(path: string, decoder: ResponseDecoder<T>) =>
    scopedQueryHandler({
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: (serverId) => {
        requireAccounts(serverId);
        return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body: {} }));
      },
    });
  const accountsRequest = <I, T>(
    parse: (value: unknown) => I,
    path: string,
    decoder: ResponseDecoder<T>,
    body: (input: I) => unknown = (input) => input,
  ) =>
    scopedHandler(parse, {
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: (input: I, serverId: string) => {
        requireAccounts(serverId);
        return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body: body(input) }));
      },
    });

  /**
   * The usage reset credits of a joined server's host's accounts, which only a host with
   * `provider-usage-reset-v1` spends. This computer's own go through `providers`.
   */
  const usageResetRequest = <I, T>(
    parse: (value: unknown) => I,
    path: string,
    decoder: ResponseDecoder<T>,
    body: (input: I) => unknown = (input) => input,
  ) =>
    scopedHandler(parse, {
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: (input: I, serverId: string) => {
        if (!remoteServers.supportsCapability(serverId, PROVIDER_USAGE_RESET_CAPABILITY))
          throw new Error(sourceText("error.team.providersUnsupported"));
        return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body: body(input) }));
      },
    });

  /**
   * A sign-in that a joined server's host starts and that opens in this computer's browser, for the
   * providers that only a host with `sign-in-relay-v1` relays. It runs here until it ends, and the
   * renderer reads `relaySignInStatus` as it does for the host's own page.
   */
  const relayed = new Map<string, RelayedSignIn>();
  const relayKey = (serverId: string, provider: AgentProviderId) => `provider\n${serverId}\n${provider}`;
  const relaySignIn = <I, T>(parse: (value: unknown) => I, run: (input: I, serverId: string) => T | Promise<T>) =>
    scopedHandler(parse, {
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: run,
    });
  function requireRelay(serverId: string, provider: AgentProviderId): void {
    if (
      !remoteServers.supportsCapability(serverId, SIGN_IN_RELAY_CAPABILITY) ||
      !SIGN_IN_RELAY_PROVIDERS.some((candidate) => candidate === provider)
    )
      throw new Error(sourceText("error.team.providersUnsupported"));
  }
  /** Starts the flow that the `start` route opens on the host, in place of any relayed sign-in of `provider`. */
  async function startRelay(serverId: string, provider: AgentProviderId, path: string, body: unknown): Promise<void> {
    const key = relayKey(serverId, provider);
    await stopRelay(key);
    const post = <T>(path: string, decoder: ResponseDecoder<T>, body: unknown) =>
      remoteServers.request(serverId, path, decoder, { method: "POST", body });
    const start = post(path, decodeSignInRelayFlow, body);
    const running: RelayedSignIn = {
      fiber: Effect.runFork(relay.run(key, signInRelayRemote(post, start))),
      result: null,
    };
    relayed.set(key, running);
    running.fiber.addObserver((exit) => {
      running.result = relayEnding(exit);
    });
  }
  async function stopRelay(key: string): Promise<void> {
    const running = relayed.get(key);
    relayed.delete(key);
    // The interrupt cancels the flow on the host, which stops the host's sign-in.
    if (running) await Effect.runPromise(Fiber.interrupt(running.fiber));
  }

  /** `providers-v8` lists the runtimes as rows; the older route sets give the IPC record. */
  function runtimeDecoder(serverId: string) {
    return remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)
      ? decodeProviderRuntimeSnapshotV8
      : decodeProviderRuntimeSnapshot;
  }
  const runtime = (route: "runtimesDownload" | "runtimesCancel") => (provider: ManagedProviderId, serverId: string) =>
    remote(serverId, runtimeRoutes(serverId)[route], { provider }, runtimeDecoder(serverId));

  return {
    providerAdmin: {
      startCodeLogin: scopedHandler(parseProviderId, {
        local: (provider) => runCauseEffect(service.startProviderCodeLogin(provider)),
        remote: (provider, serverId) =>
          remote(serverId, signInRoutes(serverId, provider).codeLoginStart, { provider }, decodeProviderCodeLoginStart),
      }),
      submitCodeLogin: scopedHandler(parseSubmitCodeLoginInput, {
        local: ({ provider, code }) => service.submitProviderCodeLogin(provider, code),
        remote: (input, serverId) => {
          if (remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY))
            return remoteChange(serverId, PROVIDERS_V8_ROUTES.codeLoginSubmit, input);
          if (remoteServers.supportsCapability(serverId, PROVIDERS_V4_CAPABILITY))
            return remoteChange(serverId, PROVIDERS_V4_ROUTES.codeLoginSubmit, input);
          if (!remoteServers.supportsCapability(serverId, PROVIDERS_SIGN_IN_V3_CAPABILITY))
            throw new Error(sourceText("error.provider.localOnly"));
          return remoteChange(serverId, PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginSubmit, input);
        },
      }),
      cancelCodeLogin: scopedHandler(parseProviderId, {
        local: (provider) => runCauseEffect(service.cancelProviderCodeLogin(provider)),
        remote: (provider, serverId) =>
          remoteChange(serverId, signInRoutes(serverId, provider).codeLoginCancel, { provider }),
      }),
      startHostSignIn: hostSignIn(async (provider, serverId) => {
        await remote(serverId, PROVIDER_HOST_SIGN_IN_ROUTES.start, { provider }, acceptEmpty);
      }),
      hostSignInStatus: hostSignIn((provider, serverId) =>
        remote(serverId, PROVIDER_HOST_SIGN_IN_ROUTES.status, { provider }, decodeProviderHostSignInStatus),
      ),
      cancelHostSignIn: hostSignIn((provider, serverId) =>
        remoteChange(serverId, PROVIDER_HOST_SIGN_IN_ROUTES.cancel, { provider }),
      ),
      accounts: accountsQuery(PROVIDER_ACCOUNTS_ROUTES.list, decodeHostProviderAccountsFromHost),
      accountUsage: accountsQuery(PROVIDER_ACCOUNTS_ROUTES.usage, decodeHostProviderAccountUsage),
      startAccountSignIn: accountsRequest(
        parseConnectProviderAccountInput,
        PROVIDER_ACCOUNTS_ROUTES.signInStart,
        acceptEmpty,
      ),
      accountSignInStatus: accountsRequest(
        parseProviderId,
        PROVIDER_ACCOUNTS_ROUTES.signInStatus,
        decodeProviderHostSignInStatus,
        (provider) => ({ provider }),
      ),
      cancelAccountSignIn: accountsRequest(
        parseProviderId,
        PROVIDER_ACCOUNTS_ROUTES.signInCancel,
        acceptEmpty,
        (provider) => ({ provider }),
      ),
      renameAccount: accountsRequest(parseRenameProviderAccountInput, PROVIDER_ACCOUNTS_ROUTES.rename, acceptEmpty),
      removeAccount: accountsRequest(parseRemoveProviderAccountInput, PROVIDER_ACCOUNTS_ROUTES.remove, acceptEmpty),
      usageResets: usageResetRequest(
        parseProviderId,
        PROVIDER_USAGE_RESET_ROUTES.list,
        decodeProviderUsageResetsFromHost,
        (provider) => ({ provider }),
      ),
      resetUsage: usageResetRequest(
        parseResetProviderUsageInput,
        PROVIDER_USAGE_RESET_ROUTES.consume,
        decodeProviderUsageResetOutcomeFromHost,
      ),
      // This computer's own sign-in goes through `providers`.
      signOut: scopedHandler(parseProviderId, {
        local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
        remote: (provider, serverId) => {
          if (!remoteServers.supportsCapability(serverId, PROVIDER_SIGN_OUT_CAPABILITY))
            throw new Error(sourceText("error.team.providersUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, PROVIDER_SIGN_OUT_ROUTES.signOut, acceptEmpty, {
              method: "POST",
              body: { provider },
            }),
          );
        },
      }),
      startRelaySignIn: relaySignIn(parseProviderId, (provider, serverId) => {
        requireRelay(serverId, provider);
        return startRelay(serverId, provider, SIGN_IN_RELAY_ROUTES.providerStart, { provider });
      }),
      startAccountRelaySignIn: relaySignIn(parseConnectProviderAccountInput, ({ provider, accountId }, serverId) => {
        const accountRelay = providerAccountRelay((capability) =>
          remoteServers.supportsCapability(serverId, capability),
        );
        if (!accountRelay?.providers.some((candidate) => candidate === provider))
          throw new Error(sourceText("error.team.providersUnsupported"));
        return startRelay(serverId, provider, accountRelay.start, { provider, accountId });
      }),
      relaySignInStatus: relaySignIn(parseProviderId, (provider, serverId): ProviderRelaySignInStatus => {
        const key = relayKey(serverId, provider);
        const running = relayed.get(key);
        if (!running) return { page: null, result: { error: sourceText("error.mcp.relayEnded") } };
        return { page: running.result ? null : relay.page(key), result: running.result };
      }),
      openRelaySignIn: relaySignIn(parseProviderId, (provider, serverId) => relay.open(relayKey(serverId, provider))),
      pasteRelaySignIn: relaySignIn(parsePasteRelaySignInInput, ({ provider, address }, serverId) =>
        relay.paste(relayKey(serverId, provider), address),
      ),
      cancelRelaySignIn: relaySignIn(parseProviderId, async (provider, serverId) => {
        await stopRelay(relayKey(serverId, provider));
        return runCauseEffect(
          remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost),
        );
      }),
      getApiKeyState: scopedHandler(parseProviderId, {
        local: (provider) => ({ provider, status: credentials.status(provider) }),
        remote: async (provider, serverId) => ({
          provider,
          status: await remote(serverId, keyRoutes(serverId).apiKeyState, { provider }, decodeProviderApiKeyStatus),
        }),
      }),
      setApiKey: scopedHandler(parseProviderApiKeyInput, {
        local: async ({ provider, key }) => {
          if (provider === "codex") return signInCodexWithApiKey(service, key);
          await runCauseEffect(runtimes.ensureKeyProviderCli(provider));
          return runCauseEffect(
            service.changeProviderCredential(provider, () =>
              credentials
                .set(provider, key)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                  ),
                ),
            ),
          );
        },
        remote: (input, serverId) => remoteChange(serverId, keyRoutes(serverId).apiKeySet, input),
      }),
      clearApiKey: scopedHandler(parseProviderId, {
        local: (provider) =>
          runCauseEffect(
            service.clearProviderCredential(provider, () =>
              credentials
                .clear(provider)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                  ),
                ),
            ),
          ),
        remote: (provider, serverId) => remoteChange(serverId, keyRoutes(serverId).apiKeyClear, { provider }),
      }),
      getRuntimes: scopedQueryHandler({
        local: () => runtimes.getStatus(),
        remote: (serverId) => remote(serverId, runtimeRoutes(serverId).runtimesStatus, {}, runtimeDecoder(serverId)),
      }),
      downloadRuntime: scopedHandler(parseManagedProviderId, {
        local: (provider) => runCauseEffect(runtimes.download(provider)),
        remote: runtime("runtimesDownload"),
      }),
      cancelRuntime: scopedHandler(parseManagedProviderId, {
        local: (provider) => runCauseEffect(runtimes.cancel(provider)),
        remote: runtime("runtimesCancel"),
      }),
      checkRuntimeUpdates: scopedQueryHandler({
        local: () => runCauseEffect(runtimes.checkForUpdates()),
        remote: (serverId) => remote(serverId, runtimeRoutes(serverId).runtimesCheck, {}, runtimeDecoder(serverId)),
      }),
      listCustomProviders: scopedQueryHandler({
        local: () => customProviders.list(),
        remote: (serverId) => remote(serverId, PROVIDERS_ADMIN_ROUTES.customList, {}, decodeCustomProviderSummaries),
      }),
      saveCustomProvider: scopedHandler(parseSaveCustomProvider, {
        local: (input) => runCauseEffect(customProviders.save(input)),
        remote: (input, serverId) =>
          remote(serverId, PROVIDERS_ADMIN_ROUTES.customSave, input, decodeCustomProviderResult),
      }),
      deleteCustomProvider: scopedHandler(parseDeleteCustomProvider, {
        local: ({ id }) => runCauseEffect(customProviders.remove(id)),
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

/** The address holds a grant, so the error never quotes it. */
function parsePasteRelaySignInInput(value: unknown): PasteProviderRelaySignInInput {
  if (!isObject(value)) throw new Error(sourceText("error.mcp.relayAddressInvalid"));
  return {
    provider: parseProviderId(value.provider),
    address: requireString(value.address, "Address", INPUT_LIMITS.signInRelayAddress),
  };
}

/** How a relayed sign-in ended, in the words the renderer shows. */
function relayEnding(exit: Exit.Exit<McpTestResult, unknown>): { error: string | null } {
  if (Exit.isSuccess(exit)) return { error: exit.value.error?.slice(0, PROVIDER_HOST_SIGN_IN_ERROR_LIMIT) ?? null };
  const cause = Cause.squash(exit.cause);
  const message = cause instanceof Error && cause.message ? cause.message : sourceText("error.mcp.relayEnded");
  return { error: message.slice(0, PROVIDER_HOST_SIGN_IN_ERROR_LIMIT) };
}

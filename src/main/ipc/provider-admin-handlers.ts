import type { DownloadableProviderId } from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentProviderId,
  type AgentStatus,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  decodeCustomProviderResult,
  decodeCustomProviderSummaries,
  decodeHostProviderAccountModels,
  decodeHostProviderAccountPools,
  decodeHostProviderAccountUsage,
  decodeProviderAccountCodeLoginStart,
  decodeProviderAccountCodeLoginStatus,
  decodeProviderApiKeyStatus,
  decodeProviderCodeLoginStart,
  decodeProviderHostSignInStatus,
  decodeProviderRuntimeSnapshot,
  decodeProviderRuntimeSnapshotV8,
  decodeSignInRelayFlow,
  type McpTestResult,
  type PasteProviderRelaySignInInput,
  type ProviderRelaySignInStatus,
  type SubmitProviderAccountCodeLoginInput,
  type SubmitProviderCodeLoginInput,
  withHostProviderAccountModels,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
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
import {
  decodeLiveVoiceAccount,
  LIVE_VOICE_ACCOUNT_CAPABILITY,
  LIVE_VOICE_ACCOUNT_ROUTES,
} from "@openbot/contracts/team-protocol/live-voice-account-v1";
import {
  PROVIDER_ACCOUNT_CODE_CAPABILITY,
  PROVIDER_ACCOUNT_CODE_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-code-v1";
import {
  PROVIDER_ACCOUNT_KEYS_CAPABILITY,
  PROVIDER_ACCOUNT_KEYS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-keys-v1";
import {
  PROVIDER_ACCOUNT_MODELS_CAPABILITY,
  PROVIDER_ACCOUNT_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-models-v1";
import {
  PROVIDER_ACCOUNT_POOL_CAPABILITY,
  PROVIDER_ACCOUNT_POOL_ROUTES,
} from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import { providerAccountRelay } from "@openbot/contracts/team-protocol/provider-account-relays";
import {
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_ACCOUNTS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  PROVIDER_DEFAULT_CAPABILITY,
  PROVIDER_DEFAULT_ROUTES,
} from "@openbot/contracts/team-protocol/provider-default-v1";
import {
  PROVIDER_HOST_SIGN_IN_CAPABILITY,
  PROVIDER_HOST_SIGN_IN_ERROR_LIMIT,
  PROVIDER_HOST_SIGN_IN_ROUTES,
} from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import { providerSignInRelay } from "@openbot/contracts/team-protocol/provider-sign-in-relays";
import {
  PROVIDER_SIGN_OUT_CAPABILITY,
  PROVIDER_SIGN_OUT_ROUTES,
} from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import {
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDER_USAGE_RESET_ROUTES,
} from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDER_USE_CAPABILITY, PROVIDER_USE_ROUTES } from "@openbot/contracts/team-protocol/provider-use-v1";
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
import { PROVIDERS_V5_CAPABILITY, PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect, Exit, Fiber } from "effect";
import { normalizePastedCode } from "../../backend/agent/cli-code-login";
import { AgentLifecycleFailed, type AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { CustomProviderChanges, PeerCustomProviderChanges } from "../custom-provider-changes";
import type { LocalSignInPages } from "../local-sign-in-pages";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import {
  decodeHostDefaultProviderFromHost,
  decodeHostProviderAccountsFromHost,
  decodeProviderUsageResetOutcomeFromHost,
  decodeProviderUsageResetsFromHost,
  decodeProviderUseFromHost,
} from "../remote-agent-decoding";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { type SignInRelayClient, signInRelayRemote } from "../sign-in-relay-client";
import { parseProviderId, parseSetup } from "./app-inputs";
import {
  parseDeleteCustomProvider,
  parseSaveCustomProvider,
  parseUpdateCustomProvider,
} from "./custom-provider-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import {
  parseConnectProviderAccountInput,
  parseConnectProviderAccountKeyInput,
  parseDownloadableProviderId,
  parseProviderApiKeyInput,
  parseProviderUseInput,
  parseRemoveProviderAccountInput,
  parseRenameProviderAccountInput,
  parseResetProviderUsageInput,
  parseSetLiveVoiceAccountInput,
  parseSetProviderAccountPoolInput,
  signInCodexWithApiKey,
} from "./provider-handlers";
import { readRemoteAgentStatus } from "./remote-agent-status";
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
    | "startProviderAccountCodeLogin"
    | "submitProviderAccountCodeLogin"
    | "providerAccountCodeLoginStatus"
    | "cancelProviderAccountSignIn"
    | "changeProviderCredential"
    | "clearProviderCredential"
    | "signInCodexWithApiKey"
  >;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<
    ProviderRuntimeManager,
    "getStatus" | "download" | "cancel" | "checkForUpdates" | "ensureKeyProviderCli"
  >;
  customProviders: PeerCustomProviderChanges & Pick<CustomProviderChanges, "update">;
  remoteServers: ProviderAdminRemoteServers;
  relay: Pick<SignInRelayClient, "run" | "page" | "open" | "paste">;
  signInPages: Pick<LocalSignInPages, "paste">;
}

interface RelayedSignIn {
  fiber: Fiber.Fiber<McpTestResult, unknown>;
  result: { error: string | null } | null;
}

const ACCOUNT_KEY_CONNECT_TIMEOUT_MS = 4 * 60_000;

export function providerAdminIpcHandlers({
  service,
  credentials,
  runtimes,
  customProviders,
  remoteServers,
  relay,
  signInPages,
}: ProviderAdminIpcDependencies): Pick<IpcGroupHandlers, "providerAdmin"> {
  function remote<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, PROVIDERS_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.provider.localOnly"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  async function remoteChange(serverId: string, path: string, body: unknown): Promise<AgentStatus> {
    await remote(serverId, path, body, acceptEmpty);
    return runCauseEffect(readRemoteAgentStatus(remoteServers, serverId));
  }

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

  function signInRoutes(serverId: string, provider: AgentProviderId) {
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)) return PROVIDERS_V8_ROUTES;
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V4_CAPABILITY)) return PROVIDERS_V4_ROUTES;
    if (remoteServers.supportsCapability(serverId, PROVIDERS_SIGN_IN_V3_CAPABILITY)) return PROVIDERS_SIGN_IN_V3_ROUTES;
    if (provider !== "codex") throw new Error(sourceText("error.provider.localOnly"));
    return PROVIDERS_ADMIN_ROUTES;
  }

  const hostSignIn = <T>(run: (provider: AgentProviderId, serverId: string) => Promise<T>) =>
    scopedHandler(parseProviderId, {
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: (provider: AgentProviderId, serverId: string) => {
        if (!remoteServers.supportsCapability(serverId, PROVIDER_HOST_SIGN_IN_CAPABILITY))
          throw new Error(sourceText("error.team.providersUnsupported"));
        return run(provider, serverId);
      },
    });

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

  function accountCode<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNT_CODE_CAPABILITY))
      throw new Error(sourceText("error.team.providersUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  function hostDefaultProvider(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, PROVIDER_DEFAULT_CAPABILITY))
      throw new Error(sourceText("error.team.providerDefaultUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeHostDefaultProviderFromHost, { method: "POST", body }),
    );
  }

  function providerUse(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, PROVIDER_USE_CAPABILITY))
      throw new Error(sourceText("error.team.providerUseUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeProviderUseFromHost, { method: "POST", body }));
  }

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

  const relayed = new Map<string, RelayedSignIn>();
  const relayKey = (serverId: string, provider: AgentProviderId) => `provider\n${serverId}\n${provider}`;
  const relaySignIn = <I, T>(parse: (value: unknown) => I, run: (input: I, serverId: string) => T | Promise<T>) =>
    scopedHandler(parse, {
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: run,
    });
  function requireRelay(serverId: string, provider: AgentProviderId): string {
    const match = providerSignInRelay(provider, (capability) => remoteServers.supportsCapability(serverId, capability));
    if (!match) throw new Error(sourceText("error.team.providersUnsupported"));
    return match.relay.start;
  }
  async function startRelay(serverId: string, provider: AgentProviderId, path: string, body: unknown): Promise<void> {
    const key = relayKey(serverId, provider);
    await stopRelay(key);
    while (relayed.has(key)) await stopRelay(key);
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
    if (running) await Effect.runPromise(Fiber.interrupt(running.fiber));
  }

  function customRoutes(serverId: string) {
    if (remoteServers.supportsCapability(serverId, CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY))
      return CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES;
    if (remoteServers.supportsCapability(serverId, CUSTOM_PROVIDER_EDIT_CAPABILITY)) return CUSTOM_PROVIDER_EDIT_ROUTES;
    return remoteServers.supportsCapability(serverId, CUSTOM_PROVIDER_HARNESS_CAPABILITY)
      ? CUSTOM_PROVIDER_HARNESS_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  }

  function runtimeDecoder(serverId: string) {
    return remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)
      ? decodeProviderRuntimeSnapshotV8
      : decodeProviderRuntimeSnapshot;
  }
  const runtime =
    (route: "runtimesDownload" | "runtimesCancel") => (provider: DownloadableProviderId, serverId: string) =>
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
      accounts: scopedQueryHandler({
        local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
        remote: (serverId) => {
          requireAccounts(serverId);
          const list = remoteServers.request(
            serverId,
            PROVIDER_ACCOUNTS_ROUTES.list,
            decodeHostProviderAccountsFromHost,
            {
              method: "POST",
              body: {},
            },
          );
          const models = remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNT_MODELS_CAPABILITY)
            ? remoteServers
                .request(serverId, PROVIDER_ACCOUNT_MODELS_ROUTES.list, decodeHostProviderAccountModels, {
                  method: "POST",
                  body: {},
                })
                .pipe(Effect.orElseSucceed(() => null))
            : Effect.succeed(null);
          const pools = remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNT_POOL_CAPABILITY)
            ? remoteServers
                .request(serverId, PROVIDER_ACCOUNT_POOL_ROUTES.list, decodeHostProviderAccountPools, {
                  method: "POST",
                  body: {},
                })
                .pipe(Effect.orElseSucceed(() => null))
            : Effect.succeed(null);
          const liveVoice = remoteServers.supportsCapability(serverId, LIVE_VOICE_ACCOUNT_CAPABILITY)
            ? remoteServers
                .request(serverId, LIVE_VOICE_ACCOUNT_ROUTES.settings, decodeLiveVoiceAccount, {
                  method: "POST",
                  body: {},
                })
                .pipe(
                  Effect.map((accountId) => ({ accountId })),
                  Effect.orElseSucceed(() => null),
                )
            : Effect.succeed(null);
          return runCauseEffect(
            Effect.all([list, models, pools, liveVoice], { concurrency: "unbounded" }).pipe(
              Effect.map(([accounts, extra, pooled, voice]) => {
                const withModels = extra ? withHostProviderAccountModels(accounts, extra) : accounts;
                const withPools = pooled ? { ...withModels, pools: pooled } : withModels;
                return voice ? { ...withPools, liveVoiceAccount: voice.accountId } : withPools;
              }),
            ),
          );
        },
      }),
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
      connectAccountKey: scopedHandler(parseConnectProviderAccountKeyInput, {
        local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNT_KEYS_CAPABILITY))
            throw new Error(sourceText("error.team.providersUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, PROVIDER_ACCOUNT_KEYS_ROUTES.connect, acceptEmpty, {
              method: "POST",
              body: input,
              timeoutMs: ACCOUNT_KEY_CONNECT_TIMEOUT_MS,
            }),
          );
        },
      }),
      startAccountCodeLogin: scopedHandler(parseConnectProviderAccountInput, {
        local: ({ provider, accountId }) => runCauseEffect(service.startProviderAccountCodeLogin(provider, accountId)),
        remote: (input, serverId) =>
          accountCode(serverId, PROVIDER_ACCOUNT_CODE_ROUTES.start, input, decodeProviderAccountCodeLoginStart),
      }),
      submitAccountCodeLogin: scopedHandler(parseSubmitAccountCodeLoginInput, {
        local: async ({ provider, accountId, code }) =>
          service.submitProviderAccountCodeLogin(provider, accountId, code),
        remote: (input, serverId) => accountCode(serverId, PROVIDER_ACCOUNT_CODE_ROUTES.submit, input, acceptEmpty),
      }),
      accountCodeLoginStatus: scopedHandler(parseRemoveProviderAccountInput, {
        local: ({ provider, accountId }) =>
          Promise.resolve(service.providerAccountCodeLoginStatus(provider, accountId)),
        remote: (input, serverId) =>
          accountCode(serverId, PROVIDER_ACCOUNT_CODE_ROUTES.status, input, decodeProviderAccountCodeLoginStatus),
      }),
      cancelAccountCodeLogin: scopedHandler(parseRemoveProviderAccountInput, {
        local: async ({ provider, accountId }) => {
          await runCauseEffect(service.cancelProviderAccountSignIn(provider, accountId));
        },
        remote: (input, serverId) => accountCode(serverId, PROVIDER_ACCOUNT_CODE_ROUTES.cancel, input, acceptEmpty),
      }),
      renameAccount: accountsRequest(parseRenameProviderAccountInput, PROVIDER_ACCOUNTS_ROUTES.rename, acceptEmpty),
      removeAccount: accountsRequest(parseRemoveProviderAccountInput, PROVIDER_ACCOUNTS_ROUTES.remove, acceptEmpty),
      setAccountPool: scopedHandler(parseSetProviderAccountPoolInput, {
        local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNT_POOL_CAPABILITY))
            throw new Error(sourceText("error.team.providersUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, PROVIDER_ACCOUNT_POOL_ROUTES.update, acceptEmpty, {
              method: "POST",
              body: input,
            }),
          );
        },
      }),
      setLiveVoiceAccount: scopedHandler(parseSetLiveVoiceAccountInput, {
        local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, LIVE_VOICE_ACCOUNT_CAPABILITY))
            throw new Error(sourceText("error.team.providersUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, LIVE_VOICE_ACCOUNT_ROUTES.update, acceptEmpty, {
              method: "POST",
              body: input,
            }),
          );
        },
      }),
      hostDefaultProvider: scopedQueryHandler({
        local: () => Promise.reject(new Error(sourceText("error.team.providerDefaultUnsupported"))),
        remote: (serverId) => hostDefaultProvider(serverId, PROVIDER_DEFAULT_ROUTES.settings, {}),
      }),
      setHostDefaultProvider: scopedHandler(parseSetup, {
        local: () => Promise.reject(new Error(sourceText("error.team.providerDefaultUnsupported"))),
        remote: (input, serverId) =>
          hostDefaultProvider(serverId, PROVIDER_DEFAULT_ROUTES.update, {
            provider: input.preferredProvider,
            model: input.preferredModel,
          }),
      }),
      providerUse: scopedQueryHandler({
        local: () => Promise.reject(new Error(sourceText("error.team.providerUseUnsupported"))),
        remote: (serverId) => providerUse(serverId, PROVIDER_USE_ROUTES.list, {}),
      }),
      setProviderUse: scopedHandler(parseProviderUseInput, {
        local: () => Promise.reject(new Error(sourceText("error.team.providerUseUnsupported"))),
        remote: (input, serverId) => providerUse(serverId, PROVIDER_USE_ROUTES.set, input),
      }),
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
        return startRelay(serverId, provider, requireRelay(serverId, provider), { provider });
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
      pasteRelaySignIn: scopedHandler(parsePasteRelaySignInInput, {
        local: ({ provider, address }) => runCauseEffect(signInPages.paste(provider, address)),
        remote: ({ provider, address }, serverId) => relay.paste(relayKey(serverId, provider), address),
      }),
      cancelRelaySignIn: relaySignIn(parseProviderId, async (provider, serverId) => {
        await stopRelay(relayKey(serverId, provider));
        return runCauseEffect(readRemoteAgentStatus(remoteServers, serverId));
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
      downloadRuntime: scopedHandler(parseDownloadableProviderId, {
        local: (provider) => runCauseEffect(runtimes.download(provider)),
        remote: runtime("runtimesDownload"),
      }),
      cancelRuntime: scopedHandler(parseDownloadableProviderId, {
        local: (provider) => runCauseEffect(runtimes.cancel(provider)),
        remote: runtime("runtimesCancel"),
      }),
      checkRuntimeUpdates: scopedQueryHandler({
        local: () => runCauseEffect(runtimes.checkForUpdates()),
        remote: (serverId) => remote(serverId, runtimeRoutes(serverId).runtimesCheck, {}, runtimeDecoder(serverId)),
      }),
      listCustomProviders: scopedQueryHandler({
        local: () => customProviders.list(),
        remote: (serverId) => remote(serverId, customRoutes(serverId).customList, {}, decodeCustomProviderSummaries),
      }),
      saveCustomProvider: scopedHandler(parseSaveCustomProvider, {
        local: (input) => runCauseEffect(customProviders.save(input)),
        remote: (input, serverId) => {
          const routes = customRoutes(serverId);
          const body =
            routes === CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES
              ? { ...input, harness: input.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS }
              : input;
          return remote(serverId, routes.customSave, body, decodeCustomProviderResult);
        },
      }),
      updateCustomProvider: scopedHandler(parseUpdateCustomProvider, {
        local: (input) => runCauseEffect(customProviders.update(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, CUSTOM_PROVIDER_EDIT_CAPABILITY))
            throw new Error(sourceText("error.provider.localOnly"));
          const body = {
            id: input.id,
            name: input.name,
            baseUrl: input.baseUrl,
            models: input.models.map(({ id, name }) => ({ id, name })),
            ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
            ...(input.headers !== undefined ? { headers: input.headers } : {}),
          };
          if (
            input.harness !== undefined &&
            remoteServers.supportsCapability(serverId, CUSTOM_PROVIDER_HARNESS_CHOICE_CAPABILITY)
          )
            return remote(
              serverId,
              CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES.customUpdate,
              { ...body, harness: input.harness },
              decodeCustomProviderResult,
            );
          return remote(serverId, CUSTOM_PROVIDER_EDIT_ROUTES.customUpdate, body, decodeCustomProviderResult);
        },
      }),
      deleteCustomProvider: scopedHandler(parseDeleteCustomProvider, {
        local: ({ id }) => runCauseEffect(customProviders.remove(id)),
        remote: (input, serverId) =>
          remote(serverId, customRoutes(serverId).customDelete, input, decodeCustomProviderResult),
      }),
    },
  };
}

function parseSubmitCodeLoginInput(value: unknown): SubmitProviderCodeLoginInput {
  if (!isDynamicRecord(value) || !isString(value.code)) throw new Error(sourceText("error.provider.codeLoginBadCode"));
  return { provider: parseProviderId(value.provider), code: normalizePastedCode(value.code) };
}

function parseSubmitAccountCodeLoginInput(value: unknown): SubmitProviderAccountCodeLoginInput {
  const { provider, code } = parseSubmitCodeLoginInput(value);
  return {
    ...parseRemoveProviderAccountInput({ provider, accountId: isDynamicRecord(value) ? value.accountId : null }),
    code,
  };
}

function parsePasteRelaySignInInput(value: unknown): PasteProviderRelaySignInInput {
  if (!isObject(value)) throw new Error(sourceText("error.mcp.relayAddressInvalid"));
  return {
    provider: parseProviderId(value.provider),
    address: requireString(value.address, "Address", INPUT_LIMITS.signInRelayAddress),
  };
}

function relayEnding(exit: Exit.Exit<McpTestResult, unknown>): { error: string | null } {
  if (Exit.isSuccess(exit)) return { error: exit.value.error?.slice(0, PROVIDER_HOST_SIGN_IN_ERROR_LIMIT) ?? null };
  const cause = Cause.squash(exit.cause);
  const message = cause instanceof Error && cause.message ? cause.message : sourceText("error.mcp.relayEnded");
  return { error: message.slice(0, PROVIDER_HOST_SIGN_IN_ERROR_LIMIT) };
}

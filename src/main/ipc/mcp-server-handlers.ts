import {
  canAdministerServer,
  decodeMcpAccessSnapshot,
  decodeMcpServerConfigs,
  decodeMcpSignInAppState,
  decodeMcpSignInStates,
  decodeMcpSignInStatus,
  decodeMcpTestResult,
  decodeSignInRelayFlow,
  hostOnlySignInPage,
  MCP_SERVERS_CAPABILITY,
  type McpAccessSnapshot,
  type McpServerConfig,
  parseSetMcpAccessInput,
  type ServerSummary,
  type TestMcpServerInput,
} from "@openbot/contracts/ipc";
import { TEAM_BROWSER_VIEW_CAPABILITY } from "@openbot/contracts/team-protocol/browser-view-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { MCP_ACCESS_CAPABILITY, MCP_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/mcp-access-v1";
import {
  MCP_SIGN_IN_APP_CAPABILITY,
  MCP_SIGN_IN_APP_ROUTES,
} from "@openbot/contracts/team-protocol/mcp-sign-in-app-v1";
import { MCP_SIGN_IN_CAPABILITY, MCP_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import {
  SIGN_IN_RELAY_DEEP_LINK_CAPABILITY,
  SIGN_IN_RELAY_DEEP_LINK_ROUTES,
} from "@openbot/contracts/team-protocol/sign-in-relay-deep-link-v1";
import { SIGN_IN_RELAY_CAPABILITY, SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { Duration, Effect, Result, Schema } from "effect";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { MCP_STDIO_PROBE_TIMEOUT_MS } from "../../backend/mcp-probe";
import { type McpToolRuntimes, needsManagedRuntime } from "../../backend/mcp-provider-shapes";
import { type McpAccessControl, mcpAccessSnapshot } from "../mcp-access-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { type SignInRelayClient, type SignInRelayRemote, signInRelayRemote } from "../sign-in-relay-client";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { LOCAL_OWNER } from "./host-admin-handlers";
import {
  parseCancelMcpSignIn,
  parseCompleteMcpSignInRelay,
  parseMcpSignInApp,
  parseRemoveMcpServer,
  parseSaveMcpServer,
  parseSaveMcpSignInApp,
  parseSetMcpServerEnabled,
  parseTestMcpServer,
} from "./mcp-inputs";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

type McpServerService = Pick<
  AgentService,
  | "listMcpServers"
  | "saveMcpServer"
  | "removeMcpServer"
  | "setMcpServerEnabled"
  | "testMcpServer"
  | "signInMcpServer"
  | "cancelMcpSignIn"
  | "mcpSignInLink"
  | "signOutMcpServer"
  | "listMcpSignIns"
  | "mcpSignInApp"
  | "saveMcpSignInApp"
  | "removeMcpSignInApp"
>;

interface McpRemoteServers {
  list(): ServerSummary[];
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

export interface McpToolRuntimePreparation {
  startToolRuntimes: () => void;
  ensureToolRuntimesReady: OmitThisParameter<ProviderRuntimeManager["ensureToolRuntimesReady"]>;
  toolRuntimes: () => McpToolRuntimes;
}

export const prepareToolRuntimeForTest = Effect.fn("Mcp.prepareToolRuntimeForTest")(function* (
  config: McpServerConfig,
  preparation: McpToolRuntimePreparation,
) {
  if (yield* needsManagedRuntime(config, preparation.toolRuntimes())) {
    yield* preparation.ensureToolRuntimesReady().pipe(
      Effect.timeout(TOOL_RUNTIME_TEST_WAIT_MS),
      Effect.catch(() => Effect.void),
    );
  }
});

interface McpServerIpcDependencies {
  service: McpServerService;
  mcpAccess: McpAccessControl;
  remoteServers: McpRemoteServers;
  startToolRuntimes: () => void;
  ensureToolRuntimesReady: OmitThisParameter<ProviderRuntimeManager["ensureToolRuntimesReady"]>;
  toolRuntimes: () => McpToolRuntimes;
  relay: Pick<SignInRelayClient, "run" | "page" | "open" | "paste" | "receivesDeepLink">;
  writeClipboard: (text: string) => Promise<void>;
}

const TOOL_RUNTIME_TEST_WAIT_MS = 60_000;

const REMOTE_TEST_TIMEOUT_MS = TOOL_RUNTIME_TEST_WAIT_MS + MCP_STDIO_PROBE_TIMEOUT_MS + 20_000;

export function mcpServerIpcHandlers({
  service,
  mcpAccess,
  remoteServers,
  startToolRuntimes,
  ensureToolRuntimesReady,
  toolRuntimes,
  relay,
  writeClipboard,
}: McpServerIpcDependencies): Pick<IpcGroupHandlers, "mcpServers"> {
  function requireRemoteSupport(serverId: string): void {
    if (!remoteServers.supportsCapability(serverId, MCP_SERVERS_CAPABILITY))
      throw new Error(sourceText("error.mcp.unsupported"));
  }

  function remoteList(serverId: string, path: string, body: unknown): Promise<McpServerConfig[]> {
    requireRemoteSupport(serverId);
    return runCauseEffect(remoteServers.request(serverId, path, decodeMcpServerConfigs, { method: "POST", body }));
  }

  function remoteAccess(serverId: string, path: string, body: unknown): Promise<McpAccessSnapshot> {
    requireRemoteSupport(serverId);
    if (!remoteServers.supportsCapability(serverId, MCP_ACCESS_CAPABILITY))
      throw new Error(sourceText("error.mcp.unsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeMcpAccessSnapshot, { method: "POST", body }));
  }

  function localAccess(): McpAccessSnapshot {
    return mcpAccessSnapshot(
      mcpAccess,
      service.listMcpServers().map((server) => server.id),
      LOCAL_OWNER,
      [],
      () => true,
    );
  }

  function requireRemoteSignIn(serverId: string): void {
    requireRemoteSupport(serverId);
    if (!remoteServers.supportsCapability(serverId, MCP_SIGN_IN_CAPABILITY)) signInOnHost();
  }

  function relayRemote(serverId: string, input: TestMcpServerInput): SignInRelayRemote<RemoteWorkflowError> {
    const post = <T>(path: string, decoder: ResponseDecoder<T>, body: unknown) =>
      remoteServers.request(serverId, path, decoder, { method: "POST", body });
    const start =
      remoteServers.supportsCapability(serverId, SIGN_IN_RELAY_DEEP_LINK_CAPABILITY) && relay.receivesDeepLink()
        ? SIGN_IN_RELAY_DEEP_LINK_ROUTES.mcpStart
        : SIGN_IN_RELAY_ROUTES.mcpStart;
    return signInRelayRemote(post, post(start, decodeSignInRelayFlow, input));
  }

  function remoteSignInApp(serverId: string, path: string, body: unknown) {
    requireRemoteSupport(serverId);
    if (!remoteServers.supportsCapability(serverId, MCP_SIGN_IN_APP_CAPABILITY))
      throw new Error(sourceText("error.mcp.signInAppUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decodeMcpSignInAppState, { method: "POST", body }));
  }

  const remotePages = new Map<string, string | null>();

  const signInRemotely = Effect.fn("Mcp.signInRemotely")(function* (serverId: string, input: TestMcpServerInput) {
    const key = remotePageKey(serverId, input.config.url);
    if (remoteServers.supportsCapability(serverId, SIGN_IN_RELAY_CAPABILITY)) {
      const relayed = yield* relay
        .run(key, hostOnlyRelayRemote(relayRemote(serverId, input)))
        .pipe(Effect.catchTag("McpHostOnlySignInPage", () => Effect.succeed(null)));
      if (relayed !== null) return relayed;
      const server = remoteServers.list().find((summary) => summary.id === serverId);
      if (!canAdministerServer(server?.role))
        return { toolCount: 0, error: sourceText("error.mcp.signInPageOnServer") };
      if (
        !remoteServers.supportsCapability(serverId, MCP_SIGN_IN_CAPABILITY) ||
        !remoteServers.supportsCapability(serverId, TEAM_BROWSER_VIEW_CAPABILITY)
      )
        return { toolCount: 0, error: sourceText("error.mcp.signInOnHost") };
      if (!server?.active) return { toolCount: 0, error: sourceText("error.mcp.signInPageOnServerSwitch") };
    }
    const body = { url: input.config.url };
    yield* remoteServers.request(serverId, MCP_SIGN_IN_ROUTES.start, () => undefined, { method: "POST", body: input });
    remotePages.set(key, null);
    return yield* Effect.gen(function* () {
      while (true) {
        const status = yield* remoteServers.request(serverId, MCP_SIGN_IN_ROUTES.status, decodeMcpSignInStatus, {
          method: "POST",
          body,
        });
        if (status.result) return status.result;
        remotePages.set(key, status.tabId);
        yield* Effect.sleep(REMOTE_SIGN_IN_POLL);
      }
    }).pipe(
      Effect.onError(() =>
        remoteServers
          .request(serverId, MCP_SIGN_IN_ROUTES.cancel, () => undefined, { method: "POST", body })
          .pipe(Effect.ignore),
      ),
      Effect.ensuring(Effect.sync(() => remotePages.delete(key))),
    );
  });

  return {
    mcpServers: {
      listMcpServers: scopedQueryHandler({
        local: () => service.listMcpServers(),
        remote: (serverId) => {
          requireRemoteSupport(serverId);
          return runCauseEffect(remoteServers.request(serverId, MCP_ROUTES.list, decodeMcpServerConfigs));
        },
      }),
      saveMcpServer: scopedHandler(parseSaveMcpServer, {
        local: (parsed) => {
          startToolRuntimes();
          return runCauseEffect(service.saveMcpServer(parsed));
        },
        remote: (parsed, serverId) => remoteList(serverId, MCP_ROUTES.save, parsed),
      }),
      removeMcpServer: scopedHandler(parseRemoveMcpServer, {
        local: (parsed) =>
          runCauseEffect(service.removeMcpServer(parsed).pipe(Effect.tap(() => mcpAccess.remove(parsed.mcpServerId)))),
        remote: (parsed, serverId) => remoteList(serverId, MCP_ROUTES.remove, parsed),
      }),
      getMcpAccess: scopedQueryHandler({
        local: () => localAccess(),
        remote: (serverId) => remoteAccess(serverId, MCP_ACCESS_ROUTES.read, {}),
      }),
      setMcpAccess: scopedHandler(parseSetMcpAccessInput, {
        local: async (parsed) => {
          const existing = new Set(service.listMcpServers().map((server) => server.id));
          if (!existing.has(parsed.mcpServerId)) throw new Error("Invalid MCP access change.");
          const saved = await Effect.runPromise(Effect.result(mcpAccess.set(parsed, existing)));
          if (Result.isFailure(saved)) {
            if (saved.failure._tag === "McpAccessStale") throw new Error(sourceText("error.team.mcpAccessStale"));
            throw saved.failure.cause;
          }
          return localAccess();
        },
        remote: (parsed, serverId) => remoteAccess(serverId, MCP_ACCESS_ROUTES.set, parsed),
      }),
      setMcpServerEnabled: scopedHandler(parseSetMcpServerEnabled, {
        local: (parsed) => {
          if (parsed.enabled) startToolRuntimes();
          return runCauseEffect(service.setMcpServerEnabled(parsed));
        },
        remote: (parsed, serverId) => remoteList(serverId, MCP_ROUTES.toggle, parsed),
      }),
      testMcpServer: scopedHandler(parseTestMcpServer, {
        local: async (parsed) => {
          await runCauseEffect(
            prepareToolRuntimeForTest(parsed.config, {
              startToolRuntimes,
              ensureToolRuntimesReady,
              toolRuntimes,
            }),
          );
          return runCauseEffect(service.testMcpServer(parsed, { storedCredentials: true, signInPlace: "here" }));
        },
        remote: (parsed, serverId) => {
          requireRemoteSupport(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, MCP_ROUTES.test, decodeMcpTestResult, {
              method: "POST",
              body: parsed,
              timeoutMs: REMOTE_TEST_TIMEOUT_MS,
            }),
          );
        },
      }),
      signInMcpServer: scopedHandler(parseTestMcpServer, {
        local: (parsed) => runCauseEffect(service.signInMcpServer(parsed)),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, SIGN_IN_RELAY_CAPABILITY)) requireRemoteSignIn(serverId);
          return runCauseEffect(signInRemotely(serverId, parsed));
        },
      }),
      mcpSignInPage: scopedHandler(parseCancelMcpSignIn, {
        local: () => null,
        remote: (parsed, serverId) => remotePages.get(remotePageKey(serverId, parsed.url)) ?? null,
      }),
      mcpSignInRelay: scopedHandler(parseCancelMcpSignIn, {
        local: () => null,
        remote: (parsed, serverId) => relay.page(remotePageKey(serverId, parsed.url)),
      }),
      openMcpSignInRelay: scopedHandler(parseCancelMcpSignIn, {
        local: () => {
          throw new Error(sourceText("error.mcp.relayEnded"));
        },
        remote: (parsed, serverId) => relay.open(remotePageKey(serverId, parsed.url)),
      }),
      completeMcpSignInRelay: scopedHandler(parseCompleteMcpSignInRelay, {
        local: () => {
          throw new Error(sourceText("error.mcp.relayEnded"));
        },
        remote: (parsed, serverId) => relay.paste(remotePageKey(serverId, parsed.url), parsed.address),
      }),
      cancelMcpSignIn: scopedHandler(parseCancelMcpSignIn, {
        local: (parsed) => service.cancelMcpSignIn(parsed),
        remote: (parsed, serverId) => {
          requireRemoteSignIn(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, MCP_SIGN_IN_ROUTES.cancel, () => undefined, {
              method: "POST",
              body: parsed,
            }),
          );
        },
      }),
      copyMcpSignInLink: scopedHandler(parseCancelMcpSignIn, {
        local: (parsed) => {
          const link = service.mcpSignInLink(parsed);
          if (!link) throw new Error(sourceText("error.mcp.signInLinkNotReady"));
          return writeClipboard(link);
        },
        remote: () => signInOnHost(),
      }),
      signOutMcpServer: scopedHandler(parseRemoveMcpServer, {
        local: (parsed) => runCauseEffect(service.signOutMcpServer(parsed)),
        remote: (parsed, serverId) => {
          requireRemoteSignIn(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, MCP_SIGN_IN_ROUTES.signOut, decodeMcpSignInStates, {
              method: "POST",
              body: parsed,
            }),
          );
        },
      }),
      listMcpSignIns: scopedQueryHandler({
        local: () => service.listMcpSignIns(),
        remote: (serverId) => {
          if (!remoteServers.supportsCapability(serverId, MCP_SIGN_IN_CAPABILITY)) return [];
          return runCauseEffect(
            remoteServers.request(serverId, MCP_SIGN_IN_ROUTES.list, decodeMcpSignInStates, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      mcpSignInApp: scopedHandler(parseMcpSignInApp, {
        local: (parsed) => service.mcpSignInApp(parsed),
        remote: (parsed, serverId) => remoteSignInApp(serverId, MCP_SIGN_IN_APP_ROUTES.get, parsed),
      }),
      saveMcpSignInApp: scopedHandler(parseSaveMcpSignInApp, {
        local: (parsed) => runCauseEffect(service.saveMcpSignInApp(parsed)),
        remote: (parsed, serverId) => remoteSignInApp(serverId, MCP_SIGN_IN_APP_ROUTES.save, parsed),
      }),
      removeMcpSignInApp: scopedHandler(parseMcpSignInApp, {
        local: (parsed) => runCauseEffect(service.removeMcpSignInApp(parsed)),
        remote: (parsed, serverId) => remoteSignInApp(serverId, MCP_SIGN_IN_APP_ROUTES.remove, parsed),
      }),
    },
  };
}

const REMOTE_SIGN_IN_POLL = Duration.seconds(1);

class McpHostOnlySignInPage extends Schema.TaggedError<McpHostOnlySignInPage>()("McpHostOnlySignInPage", {}) {}

function hostOnlyRelayRemote<E>(remote: SignInRelayRemote<E>): SignInRelayRemote<E | McpHostOnlySignInPage> {
  return {
    ...remote,
    status: (flowId) =>
      remote
        .status(flowId)
        .pipe(
          Effect.flatMap((status) =>
            status.result === null && status.authorizeUrl !== null && hostOnlySignInPage(status.authorizeUrl)
              ? Effect.fail(new McpHostOnlySignInPage())
              : Effect.succeed(status),
          ),
        ),
  };
}

function remotePageKey(serverId: string, url: string): string {
  return `${serverId}\n${url}`;
}

function signInOnHost(): never {
  throw new Error(sourceText("error.mcp.signInOnHost"));
}

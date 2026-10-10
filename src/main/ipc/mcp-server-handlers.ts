import { Duration, Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// MCP servers: the model-context servers an agent on this server may use.
//
// "Server" here is a joined team server or the local host; the MCP server is an unrelated thing, so
// every name carries `mcp`. The list belongs to the server the settings modal is open for, which is
// why nothing routes through the selected server.

import {
  decodeMcpServerConfigs,
  decodeMcpSignInStates,
  decodeMcpSignInStatus,
  decodeMcpTestResult,
  MCP_SERVERS_CAPABILITY,
  type McpServerConfig,
  type TestMcpServerInput,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { MCP_SIGN_IN_CAPABILITY, MCP_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { MCP_PROBE_TIMEOUT_MS } from "../../backend/mcp-probe";
import { type McpToolRuntimes, needsManagedRuntime } from "../../backend/mcp-provider-shapes";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { IpcGroupHandlers } from "./define-ipc-group";
import {
  parseCancelMcpSignIn,
  parseRemoveMcpServer,
  parseSaveMcpServer,
  parseSetMcpServerEnabled,
  parseTestMcpServer,
} from "./mcp-inputs";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

/** The AgentService members this registrar reaches, and nothing else. */
type McpServerService = Pick<
  AgentService,
  | "listMcpServers"
  | "saveMcpServer"
  | "removeMcpServer"
  | "setMcpServerEnabled"
  | "testMcpServer"
  | "signInMcpServer"
  | "cancelMcpSignIn"
  | "signOutMcpServer"
  | "listMcpSignIns"
>;

/** The RemoteServerManager members this registrar reaches, and nothing else. */
interface McpRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

/**
 * The managed tool runtimes as the MCP writers reach them. The IPC handlers and the host's Team
 * API routes share this shape: the routes call `AgentService` directly and would otherwise bypass
 * every preparation below, leaving a host with no Node unable to save or test its first server.
 */
export interface McpToolRuntimePreparation {
  startToolRuntimes: () => void;
  ensureToolRuntimesReady: OmitThisParameter<ProviderRuntimeManager["ensureToolRuntimesReady"]>;
  toolRuntimes: () => McpToolRuntimes;
}

/**
 * What a connection test waits for: nothing for http and installed commands, the bounded
 * download for a command nothing names. Shared by the local Test button and the host route that
 * answers a remote Test.
 */
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
  remoteServers: McpRemoteServers;
  /**
   * Fetches the tool runtimes an MCP server is started with, if this machine does not hold them
   * yet. Onboarding asks for them first; this covers the user who was already past onboarding when
   * OpenBot learned to download one. It answers at once and reports nothing, so a slow or failed
   * download cannot turn saving a row into an error.
   */
  startToolRuntimes: () => void;
  /**
   * The same download, waited for. A first stdio plugin must pass its connection test before it
   * can be saved, and without a runtime that test answers `Command not found` on a machine that
   * only needs a download. A failed download is not a test failure: the test still runs and
   * reports what the machine can actually start.
   */
  ensureToolRuntimesReady: OmitThisParameter<ProviderRuntimeManager["ensureToolRuntimesReady"]>;
  /** What the managed store holds right now, so an installed command waits for no download. */
  toolRuntimes: () => McpToolRuntimes;
}

/** How long a connection test waits for the managed runtimes before probing without them. */
const TOOL_RUNTIME_TEST_WAIT_MS = 60_000;

/**
 * The remote Test deadline: the host may wait out the preparation above before its own probe
 * deadline even starts, so the caller's request must cover both. Without this the 15-second
 * request limit reports a timeout for a download that is still running, before the host probes.
 */
const REMOTE_TEST_TIMEOUT_MS = TOOL_RUNTIME_TEST_WAIT_MS + MCP_PROBE_TIMEOUT_MS + 20_000;

export function mcpServerIpcHandlers({
  service,
  remoteServers,
  startToolRuntimes,
  ensureToolRuntimesReady,
  toolRuntimes,
}: McpServerIpcDependencies): Pick<IpcGroupHandlers, "mcpServers"> {
  /** A host that predates the capability answers 404, so the reason is stated before the request. */
  function requireRemoteSupport(serverId: string): void {
    if (!remoteServers.supportsCapability(serverId, MCP_SERVERS_CAPABILITY))
      throw new Error(sourceText("error.mcp.unsupported"));
  }

  // The shared contract decoder, as the channel-routine handlers do: it already bounds every field
  // of every configuration, so a `FromHost` twin would be the same checks under a second name.
  function remoteList(serverId: string, path: string, body: unknown): Promise<McpServerConfig[]> {
    requireRemoteSupport(serverId);
    return runCauseEffect(remoteServers.request(serverId, path, decodeMcpServerConfigs, { method: "POST", body }));
  }

  /** A host without `mcp-sign-in-v1` cannot open a sign-in page for a client. */
  function requireRemoteSignIn(serverId: string): void {
    requireRemoteSupport(serverId);
    if (!remoteServers.supportsCapability(serverId, MCP_SIGN_IN_CAPABILITY)) signInOnHost();
  }

  /** The host tab of each remote sign-in that waits, by server and address, for the panel's live view. */
  const remotePages = new Map<string, string | null>();

  /**
   * A sign-in on a joined server. The host runs it and opens the page in its own browser; this
   * computer reads `status` until it ends, because one request cannot wait for a person to sign in.
   */
  const signInRemotely = Effect.fn("Mcp.signInRemotely")(function* (serverId: string, input: TestMcpServerInput) {
    const key = remotePageKey(serverId, input.config.url);
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
      // Nobody watches the page any more, so it must not stay open on the host for the full timeout.
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
        // The one read route, and the only one the host answers to a GET.
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
        local: (parsed) => runCauseEffect(service.removeMcpServer(parsed)),
        remote: (parsed, serverId) => remoteList(serverId, MCP_ROUTES.remove, parsed),
      }),
      setMcpServerEnabled: scopedHandler(parseSetMcpServerEnabled, {
        local: (parsed) => {
          if (parsed.enabled) startToolRuntimes();
          return runCauseEffect(service.setMcpServerEnabled(parsed));
        },
        remote: (parsed, serverId) => remoteList(serverId, MCP_ROUTES.toggle, parsed),
      }),
      // The machine that holds the configuration is the machine that must make the connection, so a
      // test against a remote server runs on that host and not here.
      testMcpServer: scopedHandler(parseTestMcpServer, {
        // Silent: a test spends the sign-in this computer holds and never opens a browser. A server
        // that asks for one is answered with a sentence that points at Sign in, which the user then
        // chooses, knowing a browser opens. The remote branch reaches the host's route, which spends
        // the host's stored credentials in the same way.
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
      // A sign-in opens the browser of the computer that runs OpenBot. On a joined server that is the
      // host's browser, which the panel shows through the live view of the tab `mcpSignInPage` names.
      signInMcpServer: scopedHandler(parseTestMcpServer, {
        local: (parsed) => runCauseEffect(service.signInMcpServer(parsed)),
        remote: (parsed, serverId) => {
          requireRemoteSignIn(serverId);
          return runCauseEffect(signInRemotely(serverId, parsed));
        },
      }),
      // This computer's browser is the user's own, so a local sign-in shows no page here.
      mcpSignInPage: scopedHandler(parseCancelMcpSignIn, {
        local: () => null,
        remote: (parsed, serverId) => remotePages.get(remotePageKey(serverId, parsed.url)) ?? null,
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
      // A sign-out names its row the way a removal does, so it is read by the same parser.
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
      // A host without `mcp-sign-in-v1` holds no sign-in state to show, which is not an error.
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
    },
  };
}

/** How often a remote sign-in asks the host whether it ended. */
const REMOTE_SIGN_IN_POLL = Duration.seconds(1);

function remotePageKey(serverId: string, url: string): string {
  return `${serverId}\n${url}`;
}

function signInOnHost(): never {
  throw new Error(sourceText("error.mcp.signInOnHost"));
}

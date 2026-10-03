import { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// MCP servers: the model-context servers an agent on this server may use.
//
// "Server" here is a joined team server or the local host; the MCP server is an unrelated thing, so
// every name carries `mcp`. The list belongs to the server the settings modal is open for, which is
// why nothing routes through the selected server.

import {
  decodeMcpServerConfigs,
  decodeMcpTestResult,
  MCP_SERVERS_CAPABILITY,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../../backend/agent-service";
import { MCP_PROBE_TIMEOUT_MS } from "../../backend/mcp-probe";
import { type McpToolRuntimes, needsManagedRuntime } from "../../backend/mcp-provider-shapes";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { parseRemoveMcpServer, parseSaveMcpServer, parseSetMcpServerEnabled, parseTestMcpServer } from "./mcp-inputs";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

/** The AgentService members this registrar reaches, and nothing else. */
type McpServerService = Pick<
  AgentService,
  "listMcpServers" | "saveMcpServer" | "removeMcpServer" | "setMcpServerEnabled" | "testMcpServer"
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
    return Effect.runPromise(
      remoteServers
        .request(serverId, path, decodeMcpServerConfigs, { method: "POST", body })
        .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
    );
  }

  return {
    mcpServers: {
      listMcpServers: scopedQueryHandler({
        local: () => service.listMcpServers(),
        // The one read route, and the only one the host answers to a GET.
        remote: (serverId) => {
          requireRemoteSupport(serverId);
          return Effect.runPromise(
            remoteServers
              .request(serverId, MCP_ROUTES.list, decodeMcpServerConfigs)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          );
        },
      }),
      saveMcpServer: scopedHandler(parseSaveMcpServer, {
        local: (parsed) => {
          startToolRuntimes();
          return Effect.runPromise(service.saveMcpServer(parsed).pipe(Effect.mapError((error) => error.cause)));
        },
        remote: (parsed, serverId) => remoteList(serverId, MCP_ROUTES.save, parsed),
      }),
      removeMcpServer: scopedHandler(parseRemoveMcpServer, {
        local: (parsed) =>
          Effect.runPromise(service.removeMcpServer(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) => remoteList(serverId, MCP_ROUTES.remove, parsed),
      }),
      setMcpServerEnabled: scopedHandler(parseSetMcpServerEnabled, {
        local: (parsed) => {
          if (parsed.enabled) startToolRuntimes();
          return Effect.runPromise(service.setMcpServerEnabled(parsed).pipe(Effect.mapError((error) => error.cause)));
        },
        remote: (parsed, serverId) => remoteList(serverId, MCP_ROUTES.toggle, parsed),
      }),
      // The machine that holds the configuration is the machine that must make the connection, so a
      // test against a remote server runs on that host and not here.
      testMcpServer: scopedHandler(parseTestMcpServer, {
        // Interactive: the user pressed Test and is in front of the browser a sign-in opens. The
        // remote branch below carries no such flag; the route it reaches spends the host's stored
        // credentials instead, and still opens nothing.
        local: async (parsed) => {
          await Effect.runPromise(
            prepareToolRuntimeForTest(parsed.config, {
              startToolRuntimes,
              ensureToolRuntimesReady,
              toolRuntimes,
            }).pipe(Effect.mapError((error) => error.cause)),
          );
          return Effect.runPromise(
            service.testMcpServer(parsed, { interactive: true }).pipe(Effect.mapError((error) => error.cause)),
          );
        },
        remote: (parsed, serverId) => {
          requireRemoteSupport(serverId);
          return Effect.runPromise(
            remoteServers
              .request(serverId, MCP_ROUTES.test, decodeMcpTestResult, {
                method: "POST",
                body: parsed,
                timeoutMs: REMOTE_TEST_TIMEOUT_MS,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          );
        },
      }),
    },
  };
}

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
  type McpTestResult,
  type RemoveMcpServerInput,
  type SaveMcpServerInput,
  type SetMcpServerEnabledInput,
  type TestMcpServerInput,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import type { TestMcpServerOptions } from "../../backend/agent-service";
import { type McpToolRuntimes, needsManagedRuntime } from "../../backend/mcp-provider-shapes";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { parseAgentRequest } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseRemoveMcpServer, parseSaveMcpServer, parseSetMcpServerEnabled, parseTestMcpServer } from "./mcp-inputs";
import { routeToServer } from "./route-to-server";

/** The AgentService members this registrar reaches, and nothing else. */
export interface McpServerService {
  listMcpServers(): McpServerConfig[];
  saveMcpServer(input: SaveMcpServerInput): McpServerConfig[];
  removeMcpServer(input: RemoveMcpServerInput): McpServerConfig[];
  setMcpServerEnabled(input: SetMcpServerEnabledInput): McpServerConfig[];
  testMcpServer(input: TestMcpServerInput, options?: TestMcpServerOptions): Promise<McpTestResult>;
}

/** The RemoteServerManager members this registrar reaches, and nothing else. */
export interface McpRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit): Promise<T>;
}

/**
 * The managed tool runtimes as the MCP writers reach them. The IPC handlers and the host's Team
 * API routes share this shape: the routes call `AgentService` directly and would otherwise bypass
 * every preparation below, leaving a host with no Node unable to save or test its first server.
 */
export interface McpToolRuntimePreparation {
  startToolRuntimes: () => void;
  ensureToolRuntimesReady: () => Promise<void>;
  toolRuntimes: () => McpToolRuntimes;
}

/**
 * What a connection test waits for: nothing for http and installed commands, the bounded
 * download for a command nothing names. Shared by the local Test button and the host route that
 * answers a remote Test.
 */
export async function prepareToolRuntimeForTest(
  config: McpServerConfig,
  preparation: McpToolRuntimePreparation,
): Promise<void> {
  if (await needsManagedRuntime(config, preparation.toolRuntimes())) {
    await awaitToolRuntimes(preparation.ensureToolRuntimesReady);
  }
}

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
  ensureToolRuntimesReady: () => Promise<void>;
  /** What the managed store holds right now, so an installed command waits for no download. */
  toolRuntimes: () => McpToolRuntimes;
}

/** How long a connection test waits for the managed runtimes before probing without them. */
const TOOL_RUNTIME_TEST_WAIT_MS = 60_000;

/**
 * Waits for the download, but never past the deadline, and never as an error. Failure and
 * timeout both continue to the probe, which reports what this machine starts: the download keeps
 * running for the next attempt, and a command the runtime was never going to provide - `python`
 * on a machine without it - is still tested on its own merits.
 */
async function awaitToolRuntimes(ensure: () => Promise<void>): Promise<void> {
  // Caught before the race: a rejection that reaches `Promise.race` itself would skip the probe
  // and report a runtime download error instead of checking the configured command.
  const ready = ensure().catch(() => undefined);
  await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, TOOL_RUNTIME_TEST_WAIT_MS))]);
}

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
      throw new Error("MCP servers are not supported by this server.");
  }

  // The shared contract decoder, as the channel-routine handlers do: it already bounds every field
  // of every configuration, so a `FromHost` twin would be the same checks under a second name.
  function remoteList(serverId: string, path: string, body: unknown): Promise<McpServerConfig[]> {
    requireRemoteSupport(serverId);
    return remoteServers.request(serverId, path, decodeMcpServerConfigs, { method: "POST", body });
  }

  return {
    mcpServers: {
      list: payloadHandler(parseAgentRequest, (scoped) =>
        routeToServer<McpServerConfig[]>(scoped.serverId, {
          local: () => service.listMcpServers(),
          // The one read route, and the only one the host answers to a GET.
          remote: (serverId) => {
            requireRemoteSupport(serverId);
            return remoteServers.request(serverId, MCP_ROUTES.list, decodeMcpServerConfigs);
          },
        }),
      ),
      save: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseSaveMcpServer(scoped.payload);
        return routeToServer<McpServerConfig[]>(scoped.serverId, {
          local: () => {
            startToolRuntimes();
            return service.saveMcpServer(parsed);
          },
          remote: (serverId) => remoteList(serverId, MCP_ROUTES.save, parsed),
        });
      }),
      remove: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseRemoveMcpServer(scoped.payload);
        return routeToServer<McpServerConfig[]>(scoped.serverId, {
          local: () => service.removeMcpServer(parsed),
          remote: (serverId) => remoteList(serverId, MCP_ROUTES.remove, parsed),
        });
      }),
      setEnabled: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseSetMcpServerEnabled(scoped.payload);
        return routeToServer<McpServerConfig[]>(scoped.serverId, {
          local: () => {
            if (parsed.enabled) startToolRuntimes();
            return service.setMcpServerEnabled(parsed);
          },
          remote: (serverId) => remoteList(serverId, MCP_ROUTES.toggle, parsed),
        });
      }),
      // The machine that holds the configuration is the machine that must make the connection, so a
      // test against a remote server runs on that host and not here.
      test: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseTestMcpServer(scoped.payload);
        return routeToServer<McpTestResult>(scoped.serverId, {
          // Interactive: the user pressed Test and is in front of the browser a sign-in opens. The
          // remote branch below carries no such flag; the route it reaches spends the host's stored
          // credentials instead, and still opens nothing.
          local: async () => {
            await prepareToolRuntimeForTest(parsed.config, {
              startToolRuntimes,
              ensureToolRuntimesReady,
              toolRuntimes,
            });
            return service.testMcpServer(parsed, { interactive: true });
          },
          remote: (serverId) => {
            requireRemoteSupport(serverId);
            return remoteServers.request(serverId, MCP_ROUTES.test, decodeMcpTestResult, {
              method: "POST",
              body: parsed,
            });
          },
        });
      }),
    },
  };
}

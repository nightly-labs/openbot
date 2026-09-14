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
} from "@openbot/contracts/ipc";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import type { AgentService } from "../../backend/agent-service";
import type { RemoteServerManager } from "../remote-server-manager";
import { parseAgentRequest } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseRemoveMcpServer, parseSaveMcpServer, parseSetMcpServerEnabled, parseTestMcpServer } from "./mcp-inputs";
import { routeToServer } from "./route-to-server";

interface McpServerIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
}

export function mcpServerIpcHandlers({
  service,
  remoteServers,
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
          local: () => service.saveMcpServer(parsed),
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
          local: () => service.setMcpServerEnabled(parsed),
          remote: (serverId) => remoteList(serverId, MCP_ROUTES.toggle, parsed),
        });
      }),
      // The machine that holds the configuration is the machine that must make the connection, so a
      // test against a remote server runs on that host and not here.
      test: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseTestMcpServer(scoped.payload);
        return routeToServer<McpTestResult>(scoped.serverId, {
          local: () => service.testMcpServer(parsed),
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

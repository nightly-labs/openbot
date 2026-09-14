// MCP servers: the model-context servers an agent on this server may use.
//
// "Server" here is a joined team server or the local host; the MCP server is an unrelated thing, so
// every name carries `mcp`. The list belongs to the server the settings modal is open for, which is
// why nothing routes through the selected server.

import { decodeMcpServerEntries, MCP_SERVERS_CAPABILITY, type McpServerEntry } from "@openbot/contracts/ipc";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import type { AgentService } from "../../backend/agent-service";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { parseAgentRequest } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseRemoveMcpServer, parseSaveMcpServer, parseSetMcpServerEnabled } from "./mcp-inputs";
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
  // of every entry, so a `FromHost` twin would be the same checks under a second name.
  function remoteRequest(serverId: string, path: string, body: unknown): Promise<McpServerEntry[]> {
    requireRemoteSupport(serverId);
    return remoteServers.request(serverId, path, decodeMcpServerEntries, { method: "POST", body });
  }

  return {
    mcpServers: {
      list: payloadHandler(parseAgentRequest, (scoped) =>
        routeToServer<McpServerEntry[]>(scoped.serverId, {
          local: () => service.listMcpServers(),
          remote: (serverId) => remoteRequest(serverId, MCP_ROUTES.list, {}),
        }),
      ),
      save: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseSaveMcpServer(scoped.payload);
        return routeToServer<McpServerEntry[]>(scoped.serverId, {
          local: () => service.saveMcpServer(parsed),
          remote: (serverId) => remoteRequest(serverId, MCP_ROUTES.save, parsed),
        });
      }),
      remove: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseRemoveMcpServer(scoped.payload);
        return routeToServer<McpServerEntry[]>(scoped.serverId, {
          local: () => service.removeMcpServer(parsed),
          remote: (serverId) => remoteRequest(serverId, MCP_ROUTES.remove, parsed),
        });
      }),
      setEnabled: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseSetMcpServerEnabled(scoped.payload);
        return routeToServer<McpServerEntry[]>(scoped.serverId, {
          local: () => service.setMcpServerEnabled(parsed),
          remote: (serverId) => remoteRequest(serverId, MCP_ROUTES.toggle, parsed),
        });
      }),
      // A watch is local to the machine that holds the configurations. Against a remote host the
      // panel simply reads the list that host reports, and this machine starts nothing.
      openStatus: payloadHandler(parseAgentRequest, (scoped) =>
        routeToServer<McpServerEntry[]>(scoped.serverId, {
          local: () => service.openMcpStatus(),
          remote: (serverId) => remoteRequest(serverId, MCP_ROUTES.list, {}),
        }),
      ),
      closeStatus: payloadHandler(parseAgentRequest, (scoped) =>
        routeToServer<void>(scoped.serverId, {
          local: () => service.closeMcpStatus(),
          remote: () => decodeVoid(null),
        }),
      ),
    },
  };
}

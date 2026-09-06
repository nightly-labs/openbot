// An agent's long-lived memories: the notes it carries between threads.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { AgentService } from "../../backend/agent-service";
import { decodeAgentMemories, decodeAgentMemory } from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseAgentRequest,
  parseCreateAgentMemory,
  parseDeleteAgentMemory,
  parseUpdateAgentMemory,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { requireString } from "./validation";

interface MemoryIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
}

export function memoryIpcHandlers({
  service,
  remoteServers,
}: MemoryIpcDependencies): Pick<IpcGroupHandlers, "agentMemories"> {
  return {
    agentMemories: {
      listMemories: payloadHandler(parseAgentRequest, (scoped) => {
        const agentId = requireString(scoped.payload, "agentId", INPUT_LIMITS.identifier);
        return routeToServer(scoped.serverId, {
          local: () => service.listMemories(agentId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(agentId), decodeAgentMemories),
        });
      }),
      createMemory: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseCreateAgentMemory(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.createMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(parsed.agentId), decodeAgentMemory, {
              method: "POST",
              body: { text: parsed.text },
            }),
        });
      }),
      updateMemory: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseUpdateAgentMemory(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.updateMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(
              serverId,
              TEAM_API_ROUTES.agent.memory(parsed.agentId, parsed.memoryId),
              decodeAgentMemory,
              {
                method: "PATCH",
                body: { text: parsed.text },
              },
            ),
        });
      }),
      deleteMemory: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseDeleteAgentMemory(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.deleteMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memory(parsed.agentId, parsed.memoryId), decodeVoid, {
              method: "DELETE",
            }),
        });
      }),
      clearMemories: payloadHandler(parseAgentRequest, (scoped) => {
        const agentId = requireString(scoped.payload, "agentId", INPUT_LIMITS.identifier);
        return routeToServer(scoped.serverId, {
          local: () => service.clearMemories(agentId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(agentId), decodeVoid, { method: "DELETE" }),
        });
      }),
    },
  };
}

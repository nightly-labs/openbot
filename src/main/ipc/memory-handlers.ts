// An agent's long-lived memories: the notes it carries between threads.

import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { AgentService } from "../../backend/agent-service";
import { decodeAgentMemories, decodeAgentMemory } from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { parseAgentId, parseCreateAgentMemory, parseDeleteAgentMemory, parseUpdateAgentMemory } from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

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
      listMemories: scopedHandler(parseAgentId, {
        local: (agentId) => service.listMemories(agentId),
        remote: (agentId, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(agentId), decodeAgentMemories),
      }),
      createMemory: scopedHandler(parseCreateAgentMemory, {
        local: (parsed) => service.createMemory(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(parsed.agentId), decodeAgentMemory, {
            method: "POST",
            body: { text: parsed.text },
          }),
      }),
      updateMemory: scopedHandler(parseUpdateAgentMemory, {
        local: (parsed) => service.updateMemory(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(
            serverId,
            TEAM_API_ROUTES.agent.memory(parsed.agentId, parsed.memoryId),
            decodeAgentMemory,
            {
              method: "PATCH",
              body: { text: parsed.text },
            },
          ),
      }),
      deleteMemory: scopedHandler(parseDeleteAgentMemory, {
        local: (parsed) => service.deleteMemory(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.memory(parsed.agentId, parsed.memoryId), decodeVoid, {
            method: "DELETE",
          }),
      }),
      clearMemories: scopedHandler(parseAgentId, {
        local: (agentId) => service.clearMemories(agentId),
        remote: (agentId, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(agentId), decodeVoid, { method: "DELETE" }),
      }),
    },
  };
}

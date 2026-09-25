// Routines: the scheduled standing instructions attached to one agent.

import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { AgentService } from "../../backend/agent-service";
import { decodeRoutine, decodeRoutineRun, decodeRoutineRuns, decodeRoutines } from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseAgentId,
  parseCreateRoutine,
  parseDeleteRoutine,
  parseListRoutineRuns,
  parseTestRoutine,
  parseUpdateRoutine,
} from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

interface RoutineIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
}

export function routineIpcHandlers({
  service,
  remoteServers,
}: RoutineIpcDependencies): Pick<IpcGroupHandlers, "agentRoutines"> {
  return {
    agentRoutines: {
      listRoutines: scopedHandler(parseAgentId, {
        local: (agentId) => service.listRoutines(agentId),
        remote: (agentId, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines),
      }),
      createRoutine: scopedHandler(parseCreateRoutine, {
        local: (parsed) => service.createRoutine(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(parsed.agentId), decodeRoutine, {
            method: "POST",
            body: parsed,
          }),
      }),
      updateRoutine: scopedHandler(parseUpdateRoutine, {
        local: (parsed) => service.updateRoutine(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(
            serverId,
            TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId),
            decodeRoutine,
            {
              method: "PATCH",
              body: parsed,
            },
          ),
      }),
      deleteRoutine: scopedHandler(parseDeleteRoutine, {
        local: (parsed) => service.deleteRoutine(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId), decodeVoid, {
            method: "DELETE",
          }),
      }),
      testRoutine: scopedHandler(parseTestRoutine, {
        local: (parsed) => service.testRoutine(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(
            serverId,
            TEAM_API_ROUTES.agent.routineTest(parsed.agentId, parsed.routineId),
            decodeRoutineRun,
            { method: "POST" },
          ),
      }),
      listRoutineRuns: scopedHandler(parseListRoutineRuns, {
        local: (parsed) => service.listRoutineRuns(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(
            serverId,
            `${TEAM_API_ROUTES.agent.routineRuns(parsed.agentId, parsed.routineId)}?limit=${parsed.limit}`,
            decodeRoutineRuns,
          ),
      }),
    },
  };
}

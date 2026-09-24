// Routines: the scheduled standing instructions attached to one agent.

import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { AgentService } from "../../backend/agent-service";
import { decodeRoutine, decodeRoutineRun, decodeRoutineRuns, decodeRoutines } from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  agentRequest,
  parseAgentId,
  parseCreateRoutine,
  parseDeleteRoutine,
  parseListRoutineRuns,
  parseTestRoutine,
  parseUpdateRoutine,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";

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
      listRoutines: payloadHandler(agentRequest(parseAgentId), (scoped) => {
        const agentId = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.listRoutines(agentId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines),
        });
      }),
      createRoutine: payloadHandler(agentRequest(parseCreateRoutine), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.createRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(parsed.agentId), decodeRoutine, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      updateRoutine: payloadHandler(agentRequest(parseUpdateRoutine), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.updateRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(
              serverId,
              TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId),
              decodeRoutine,
              {
                method: "PATCH",
                body: parsed,
              },
            ),
        });
      }),
      deleteRoutine: payloadHandler(agentRequest(parseDeleteRoutine), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.deleteRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(
              serverId,
              TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId),
              decodeVoid,
              {
                method: "DELETE",
              },
            ),
        });
      }),
      testRoutine: payloadHandler(agentRequest(parseTestRoutine), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.testRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(
              serverId,
              TEAM_API_ROUTES.agent.routineTest(parsed.agentId, parsed.routineId),
              decodeRoutineRun,
              { method: "POST" },
            ),
        });
      }),
      listRoutineRuns: payloadHandler(agentRequest(parseListRoutineRuns), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.listRoutineRuns(parsed),
          remote: (serverId) =>
            remoteServers.request(
              serverId,
              `${TEAM_API_ROUTES.agent.routineRuns(parsed.agentId, parsed.routineId)}?limit=${parsed.limit}`,
              decodeRoutineRuns,
            ),
        });
      }),
    },
  };
}

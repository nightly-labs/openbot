// The agent routines a routine canvas shows: every trigger kind, so a webhook routine brings its URL,
// event type and filters with it. The trigger reads as it does in the events API.

import type { RoutineFlowRoutineInfo } from "@openbot/contracts/ipc";
import type { AgentRoutineStore } from "../agent-routine-store";
import type { OwnedRoutineRecord } from "../routine-store";
import type { RoutineFlowsDependencies } from "./routine-flows";

function flowRoutine({ ownerId, trigger, ...fields }: OwnedRoutineRecord): RoutineFlowRoutineInfo {
  return {
    ...fields,
    agentId: ownerId,
    trigger:
      trigger.kind === "schedule"
        ? { kind: "schedule", schedule: trigger.schedule }
        : { kind: "webhook", url: trigger.url, eventType: trigger.eventType, filters: trigger.filters },
  };
}

export function routineFlowRoutines(routines: AgentRoutineStore): RoutineFlowsDependencies["routines"] {
  return {
    list: (agentId) => routines.listRecords(agentId).map(flowRoutine),
    get: (agentId, routineId) => {
      const record = routines.getRecord(agentId, routineId);
      return record ? flowRoutine(record) : null;
    },
    listRuns: (agentId, routineId, limit) => routines.listRuns(agentId, routineId, limit),
  };
}

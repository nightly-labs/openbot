import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import type { EventRoutinesApi } from "../conversation/routine-webhooks-api";
import type { RoutineFlowsHost } from "../routine-flows/routine-flows-port";
import { openWebLink } from "./web-attachments";
import type { WebWorkspaceRuntime } from "./web-runtime";

export function webRoutineFlowsHost(
  remote: WebWorkspaceRuntime,
  onHostEvent: (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void,
  webhooks: () => EventRoutinesApi | undefined,
  stops: () => boolean,
): RoutineFlowsHost | null {
  const { routineFlows, updateRoutine, testRoutine, conversationAround } = remote;
  if (!routineFlows || !updateRoutine || !testRoutine) return null;
  return {
    flows: routineFlows,
    get stopRun() {
      return stops() ? routineFlows.stopRun : undefined;
    },
    routines: { update: updateRoutine, test: testRoutine },
    get webhooks() {
      return webhooks();
    },
    conversation: {
      send: ({ agentId, text, clientMessageId }) => remote.send(agentId, text, [], null, clientMessageId),
      page: (agentId, aroundMessageId) =>
        aroundMessageId && conversationAround
          ? conversationAround(agentId, aroundMessageId)
          : remote.conversation(agentId),
    },
    onEvent: onHostEvent,
    openUrl: openWebLink,
  };
}

import type { AgentMessage, ChatActionMarkerModel, RoutineRunMarkerTransition } from "../../data";

type RoutineRunMarker = Extract<ChatActionMarkerModel, { kind: "routine-run" }>;

interface IndexedTransition extends RoutineRunMarkerTransition {
  index: number;
}

/**
 * Reduces the durable transition log to one visible summary for each routine run.
 * The stored messages stay unchanged, so the summary can be rebuilt after refresh or pagination.
 */
export function summarizeRoutineRunMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  const transitionsByRun = new Map<string, IndexedTransition[]>();

  messages.forEach((message, index) => {
    const marker = routineRunMarker(message);
    if (!marker) return;
    const transitions = transitionsByRun.get(marker.runId) ?? [];
    transitions.push({ index, status: marker.status, timestamp: marker.timestamp });
    transitionsByRun.set(marker.runId, transitions);
  });

  return messages.flatMap((message, index) => {
    const marker = routineRunMarker(message);
    if (!marker) return [message];
    const transitions = transitionsByRun.get(marker.runId);
    if (!transitions || transitions.length === 1) return [message];
    const latest = transitions.at(-1);
    if (latest?.index === index) {
      return [
        {
          ...message,
          actionMarker: {
            ...marker,
            previousTransitions: transitions.slice(0, -1).map(({ status, timestamp }) => ({ status, timestamp })),
          },
        },
      ];
    }

    // The queued marker shares a row with the routine instruction. Keep that user content, but
    // remove its superseded status. Later transition messages contain no separate chat content.
    if (message.routine) return [{ ...message, kind: "text", actionMarker: undefined }];
    return [];
  });
}

function routineRunMarker(message: AgentMessage): RoutineRunMarker | null {
  return message.actionMarker?.kind === "routine-run" ? message.actionMarker : null;
}

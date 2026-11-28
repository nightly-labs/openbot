import type { AgentEvent } from "../ipc-agent-events";
import { isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord, isString } from "../runtime-values";

export const ROUTINE_THREAD_TURN_CAPABILITY = "routine-thread-turn-v1";

type TurnOrigin = "user" | "routine" | "agent" | "unknown";

export interface RoutineThreadTurnCompletedEvent {
  type: "routine-thread-turn-completed";
  agentId: string;
  threadId: string;
  taskId: string;
  turnId: string;
  status: string;
  origin?: TurnOrigin;
}

function isTurnOrigin(value: unknown): value is TurnOrigin {
  return value === "user" || value === "routine" || value === "agent" || value === "unknown";
}

export function routineThreadTurnEvent(value: unknown): RoutineThreadTurnCompletedEvent | null {
  if (!isDynamicRecord(value) || value.type !== "routine-thread-turn-completed") return null;
  if (
    !isString(value.agentId) ||
    !isString(value.threadId) ||
    !isIdentifier(value.taskId) ||
    !isString(value.turnId) ||
    !isString(value.status) ||
    (value.origin !== undefined && !isTurnOrigin(value.origin))
  )
    throw new Error("Invalid routine thread turn completion.");
  return {
    type: "routine-thread-turn-completed",
    agentId: value.agentId,
    threadId: value.threadId,
    taskId: value.taskId,
    turnId: value.turnId,
    status: value.status,
    ...(value.origin === undefined ? {} : { origin: value.origin }),
  };
}

export function routineThreadTurnForPeer(
  event: Extract<AgentEvent, { type: "thread-turn-completed" }>,
): RoutineThreadTurnCompletedEvent | null {
  if (!event.routine) return null;
  const { agentId, threadId, turnId, status, origin } = event.turn;
  return {
    type: "routine-thread-turn-completed",
    agentId,
    threadId,
    taskId: event.taskId,
    turnId,
    status,
    ...(origin === undefined ? {} : { origin }),
  };
}

export function routineThreadTurnToCurrent(
  event: RoutineThreadTurnCompletedEvent,
): Extract<AgentEvent, { type: "thread-turn-completed" }> {
  const { agentId, threadId, taskId, turnId, status, origin } = event;
  return {
    type: "thread-turn-completed",
    taskId,
    routine: true,
    turn: { type: "turn-completed", agentId, threadId, turnId, status, ...(origin === undefined ? {} : { origin }) },
  };
}

import { isDynamicRecord, isString } from "../runtime-values";

export const TEAMMATE_RESULT_TURN_CAPABILITY = "teammate-result-turn-v1";

export interface TeammateResultTurnCompletedEvent {
  type: "teammate-result-turn-completed";
  agentId: string;
  threadId: string;
  turnId: string;
  status: string;
}

export function teammateResultTurnEvent(value: unknown): TeammateResultTurnCompletedEvent | null {
  if (!isDynamicRecord(value) || value.type !== "teammate-result-turn-completed") return null;
  if (!isString(value.agentId) || !isString(value.threadId) || !isString(value.turnId) || !isString(value.status))
    throw new Error("Invalid teammate result turn completion.");
  return {
    type: "teammate-result-turn-completed",
    agentId: value.agentId,
    threadId: value.threadId,
    turnId: value.turnId,
    status: value.status,
  };
}

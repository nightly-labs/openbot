import type { ConversationSnapshot } from "@openbot/contracts/ipc";

/** Projects chat messages without changing the durable run and conversation history. */
export function visibleRoutineStatusSnapshot(snapshot: ConversationSnapshot): ConversationSnapshot {
  return { ...snapshot, messages: snapshot.messages.filter((message) => message.silentRoutineStatus !== true) };
}

export const VISIBLE_ROUTINE_STATUS_SQL = "COALESCE(json_extract(message_json, '$.silentRoutineStatus'), 0) != 1";

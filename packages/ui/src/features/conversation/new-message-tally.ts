import { ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";

export interface TimelineRow {
  id: string;
  countable: boolean;
}

export interface NewMessageTally {
  count: number;
  anchorId: string | undefined;
}

export function anchorNewMessages(rows: readonly TimelineRow[]): NewMessageTally {
  return { count: 0, anchorId: rows.at(-1)?.id };
}

export function tallyNewMessages(
  previous: NewMessageTally,
  rows: readonly TimelineRow[],
  following: boolean,
): NewMessageTally {
  if (following) return anchorNewMessages(rows);
  const latest = rows[rows.length - 1];
  if (!latest) return { count: 0, anchorId: undefined };
  const latestId = latest.id;
  const anchorIndex = previous.anchorId === undefined ? -1 : rows.findIndex((row) => row.id === previous.anchorId);
  if (anchorIndex < 0) return { count: previous.count, anchorId: latestId };
  let arrived = 0;
  for (let index = anchorIndex + 1; index < rows.length; index += 1) {
    if (rows[index]?.countable) arrived += 1;
  }
  return { count: previous.count + arrived, anchorId: latestId };
}

export function countableTimelineMessage(message: AgentMessage): boolean {
  if (message.author === "you") return false;
  if (
    message.kind === "thinking" ||
    message.kind === "plan" ||
    message.kind === "subagents" ||
    message.kind === "memory-changes"
  )
    return false;
  if (silentAgentAnswer(message)) return false;
  if (message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE) return false;
  if (message.actionMarker && !message.exchange) return false;
  return true;
}

export function silentAgentAnswer(message: AgentMessage): boolean {
  return (
    message.author === "agent" &&
    (message.kind ?? "text") === "text" &&
    !message.streaming &&
    !message.status &&
    !message.actionMarker &&
    !message.questionPrompt &&
    !message.imageGeneration &&
    !message.videoGeneration &&
    !message.attachments?.length &&
    !message.reactions?.length &&
    !message.body.trim()
  );
}

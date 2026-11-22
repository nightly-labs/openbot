import { ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "@openbot/contracts/ipc";
import type { AgentMessage, AgentMessageMarkerModel } from "@openbot/ui/data";
import { dayMarkerLabel } from "@openbot/ui/features/conversation/chat-day-markers";

interface AgentMessageRow {
  message: AgentMessage;
  marker: AgentMessageMarkerModel;
}

export function groupAgentMessageMarkers(
  messages: readonly AgentMessage[],
  firstUnreadMessageId?: string | null,
): AgentMessage[] {
  const rows: AgentMessage[] = [];
  let run: AgentMessageRow[] = [];
  const closeRun = () => {
    const first = run[0];
    const last = run.at(-1);
    if (first && last) {
      rows.push(
        run.length === 1
          ? first.message
          : {
              ...first.message,
              actionMarker: {
                kind: "agent-message-group",
                messages: run.map((row) => ({ id: row.message.id, marker: row.marker })),
                timestamp: last.marker.timestamp,
              },
            },
      );
    }
    run = [];
  };

  for (const message of messages) {
    const marker = groupableMarker(message);
    if (!marker) {
      closeRun();
      rows.push(message);
      continue;
    }
    const previous = run.at(-1)?.message;
    if (previous && (message.id === firstUnreadMessageId || startsDay(previous, message))) closeRun();
    run.push({ message, marker });
  }
  closeRun();
  return rows;
}

export function markOpenAgentMessages(
  messages: readonly AgentMessage[],
  open: ReadonlySet<string>,
  answers: ReadonlyMap<string, readonly AgentMessage[]>,
): AgentMessage[] {
  return messages.map((message) => {
    const marker = message.actionMarker;
    if (marker?.kind !== "agent-message") return message;
    if (message.body.trim() === "" && !answers.has(marker.messageId)) return message;
    return { ...message, actionMarker: { ...marker, expanded: open.has(marker.messageId) } };
  });
}

export function teammateTurnAnswers(messages: readonly AgentMessage[]): Map<string, AgentMessage[]> {
  const updateByTurn = new Map<string, string>();
  for (const message of messages) {
    const exchange = message.exchange;
    if (
      message.turnId &&
      exchange?.direction === "incoming" &&
      (exchange.expectsReply === false || !exchange.replyToMessageId)
    )
      updateByTurn.set(message.turnId, exchange.messageId);
  }
  const answers = new Map<string, AgentMessage[]>();
  if (updateByTurn.size === 0) return answers;
  for (const message of messages) {
    const exchangeId = message.turnId && updateByTurn.get(message.turnId);
    if (!exchangeId || message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE) continue;
    const turnAnswers = answers.get(exchangeId) ?? [];
    turnAnswers.push(message);
    answers.set(exchangeId, turnAnswers);
  }
  return answers;
}

function groupableMarker(message: AgentMessage): AgentMessageMarkerModel | null {
  if (message.actionMarker?.kind !== "agent-message") return null;
  if (message.exchange?.direction === "incoming" && (message.attachments?.length ?? 0) > 0) return null;
  return message.actionMarker;
}

export function startsDay(previous: AgentMessage, current: AgentMessage): boolean {
  return current.createdAt !== undefined && dayMarkerLabel(previous.createdAt, current.createdAt) !== null;
}

export function groupedMessageIds(message: AgentMessage | undefined): string | undefined {
  const marker = message?.actionMarker;
  if (marker?.kind === "agent-message-group") return marker.messages.map((entry) => entry.id).join(" ");
  if (marker?.kind === "routine-run-group") return marker.runs.map((entry) => entry.id).join(" ");
  if (marker?.kind === "skill-lifecycle") return marker.installMessageIds?.join(" ");
  return undefined;
}

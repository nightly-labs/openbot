import { ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "@openbot/contracts/ipc";
import type { AgentMessage, AgentMessageMarkerModel } from "@openbot/ui/data";
import { dayMarkerLabel } from "@openbot/ui/features/conversation/chat-day-markers";

interface AgentMessageRow {
  message: AgentMessage;
  marker: AgentMessageMarkerModel;
}

/**
 * Joins consecutive messages to and from other agents into one row, so a long exchange between
 * agents does not fill the chat. The row keeps the id of the first message, so it stays the same row
 * while the exchange grows. The stored messages stay unchanged.
 *
 * A run stops at the first unread message and at a new day, so the unread divider and the day
 * separator keep a row of their own.
 */
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

/**
 * Sets on the marker of each agent message that has text or quiet answers whether they show under
 * the marker. `open` holds the exchange ids of the open messages, and `answers` the quiet answers by
 * exchange id (`teammateUpdateAnswers`). A message with neither gets no toggle.
 */
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

/**
 * The quiet answers of each turn that teammate updates started, by the exchange id of the last update
 * of the turn. An update wants no answer, so when nothing in the turn was for the user, OpenBot kept
 * the agent's text as quiet answers (#6821). They show under the marker of the update, which starts
 * closed, as the answers of a quiet routine run show under its run. A turn with no teammate update
 * keeps its quiet answers in place.
 */
export function teammateUpdateAnswers(messages: readonly AgentMessage[]): Map<string, AgentMessage[]> {
  const updateByTurn = new Map<string, string>();
  for (const message of messages) {
    const exchange = message.exchange;
    if (message.turnId && exchange?.direction === "incoming" && exchange.expectsReply === false)
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

/** A message with attachments draws them under its marker, so it keeps a row of its own. */
function groupableMarker(message: AgentMessage): AgentMessageMarkerModel | null {
  if (message.actionMarker?.kind !== "agent-message") return null;
  if (message.exchange?.direction === "incoming" && (message.attachments?.length ?? 0) > 0) return null;
  return message.actionMarker;
}

/** Whether a message falls on a new day after the previous one, so a day separator comes between them. */
export function startsDay(previous: AgentMessage, current: AgentMessage): boolean {
  return current.createdAt !== undefined && dayMarkerLabel(previous.createdAt, current.createdAt) !== null;
}

/**
 * The ids of the messages in a group row of agent messages, routine runs or skill installs, separated
 * by spaces, so a search or focus request finds the row.
 */
export function groupedMessageIds(message: AgentMessage | undefined): string | undefined {
  const marker = message?.actionMarker;
  if (marker?.kind === "agent-message-group") return marker.messages.map((entry) => entry.id).join(" ");
  if (marker?.kind === "routine-run-group") return marker.runs.map((entry) => entry.id).join(" ");
  if (marker?.kind === "skill-lifecycle") return marker.installMessageIds?.join(" ");
  return undefined;
}

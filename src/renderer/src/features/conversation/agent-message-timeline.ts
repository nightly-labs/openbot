import type { AgentMessage, AgentMessageMarkerModel } from "@openbot/ui/data";
import { dayMarkerLabel } from "./chat-day-markers";

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

/** A message with attachments draws them under its marker, so it keeps a row of its own. */
function groupableMarker(message: AgentMessage): AgentMessageMarkerModel | null {
  if (message.actionMarker?.kind !== "agent-message") return null;
  if (message.exchange?.direction === "incoming" && (message.attachments?.length ?? 0) > 0) return null;
  return message.actionMarker;
}

function startsDay(previous: AgentMessage, current: AgentMessage): boolean {
  return current.createdAt !== undefined && dayMarkerLabel(previous.createdAt, current.createdAt) !== null;
}

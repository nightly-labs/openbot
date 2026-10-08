import type { AgentMessage, RoutineRunMarkerModel, RoutineRunMarkerTransition } from "@openbot/ui/data";
import { startsDay } from "./agent-message-timeline";

type RoutineRunMarker = RoutineRunMarkerModel;

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

    // The routine instruction shows only as its marker, so a superseded state has no row. The
    // stored instruction stays unchanged.
    return [];
  });
}

function routineRunMarker(message: AgentMessage): RoutineRunMarker | null {
  return message.actionMarker?.kind === "routine-run" ? message.actionMarker : null;
}

interface CompletedRunRow {
  message: AgentMessage;
  marker: RoutineRunMarker;
}

/**
 * Joins consecutive completed runs of the same routine into one row, so a routine that runs often
 * does not fill the chat. Use it on rows that `summarizeRoutineRunMessages` made. The row keeps the
 * id of the first run, so it stays the same row while new runs join. The stored messages stay
 * unchanged.
 *
 * Any other row stops the group, and so does a run that did not complete: a failure keeps a row of
 * its own. A group also stops at the first unread message and at a new day, so the unread divider
 * and the day separator keep a row of their own.
 */
export function groupRoutineRunMarkers(
  messages: readonly AgentMessage[],
  firstUnreadMessageId?: string | null,
): AgentMessage[] {
  const rows: AgentMessage[] = [];
  let group: CompletedRunRow[] = [];
  const closeGroup = () => {
    const first = group[0];
    const last = group.at(-1);
    if (first && last) {
      rows.push(
        group.length === 1
          ? first.message
          : {
              ...first.message,
              actionMarker: {
                kind: "routine-run-group",
                routineId: first.marker.routineId,
                routineName: last.marker.routineName,
                runs: group.map((row) => ({ id: row.message.id, marker: row.marker })),
                timestamp: last.marker.timestamp,
              },
            },
      );
    }
    group = [];
  };

  for (const message of messages) {
    const marker = completedRunMarker(message);
    if (!marker) {
      closeGroup();
      rows.push(message);
      continue;
    }
    const previous = group.at(-1);
    if (
      previous &&
      (previous.marker.routineId !== marker.routineId ||
        message.id === firstUnreadMessageId ||
        startsDay(previous.message, message))
    ) {
      closeGroup();
    }
    group.push({ message, marker });
  }
  closeGroup();
  return rows;
}

function completedRunMarker(message: AgentMessage): RoutineRunMarker | null {
  const marker = routineRunMarker(message);
  return marker?.status === "succeeded" ? marker : null;
}

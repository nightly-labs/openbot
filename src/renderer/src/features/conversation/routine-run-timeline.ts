import { ROUTINE_QUIET_ANSWER_ITEM_TYPE } from "@openbot/contracts/ipc";
import type {
  AgentMessage,
  ChatActionMarkerModel,
  RoutineRunMarkerModel,
  RoutineRunMarkerTransition,
} from "@openbot/ui/data";
import { startsDay } from "./agent-message-timeline";

type RoutineRunMarker = RoutineRunMarkerModel;

interface IndexedTransition extends RoutineRunMarkerTransition {
  index: number;
  message: AgentMessage;
  marker: RoutineRunMarker;
}

export function summarizeRoutineRunMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  const transitionsByRun = new Map<string, IndexedTransition[]>();

  messages.forEach((message, index) => {
    const marker = routineRunMarker(message);
    if (!marker) return;
    const transitions = transitionsByRun.get(marker.runId) ?? [];
    transitions.push({ index, status: marker.status, timestamp: marker.timestamp, message, marker });
    transitionsByRun.set(marker.runId, transitions);
  });

  return messages.flatMap((message, index) => {
    const marker = routineRunMarker(message);
    if (!marker) return [message];
    const transitions = transitionsByRun.get(marker.runId) ?? [];
    const latest = transitions.at(-1);
    if (!latest || transitions.length === 1) return [message];
    if (transitions[0]?.index === index) {
      const { createdAt: _latestCreatedAt, ...latestRow } = latest.message;
      return [
        {
          ...latestRow,
          id: message.id,
          time: message.time,
          ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
          actionMarker: {
            ...latest.marker,
            previousTransitions: transitions.slice(0, -1).map(({ status, timestamp }) => ({ status, timestamp })),
          },
        },
      ];
    }

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
    if (!marker || marker.expanded) {
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

type RoutineRunGroupMarker = Extract<ChatActionMarkerModel, { kind: "routine-run-group" }>;

export type RoutineRunOpenState = ReadonlyMap<string, boolean>;

export function routineRunToggleKey(marker: RoutineRunMarker | RoutineRunGroupMarker): string {
  return marker.kind === "routine-run" ? marker.runId : `group:${marker.runs[0]?.marker.runId ?? ""}`;
}

export function routineRunTurnMessages(
  stored: readonly AgentMessage[],
  drawn: readonly AgentMessage[],
): Map<string, AgentMessage[]> {
  const runByTurn = new Map<string, string>();
  const sharedTurns = new Set<string>();
  for (const message of stored) {
    if (!message.turnId) continue;
    if (message.routine) {
      const runId = runByTurn.get(message.turnId);
      if (runId !== undefined && runId !== message.routine.runId) sharedTurns.add(message.turnId);
      runByTurn.set(message.turnId, message.routine.runId);
    } else if (message.author === "you" || fromTeammate(message)) {
      sharedTurns.add(message.turnId);
    }
  }
  for (const turnId of sharedTurns) runByTurn.delete(turnId);
  const turns = new Map<string, AgentMessage[]>();
  if (runByTurn.size === 0) return turns;
  for (const message of drawn) {
    if (!message.turnId || message.routine || message.author === "you") continue;
    const runId = runByTurn.get(message.turnId);
    if (!runId) continue;
    const messages = turns.get(runId) ?? [];
    messages.push(message);
    turns.set(runId, messages);
  }
  return turns;
}

function fromTeammate(message: AgentMessage): boolean {
  return message.senderAgentId !== undefined && message.exchange?.direction !== "outgoing";
}

export function placeRoutineRunTurns(
  rows: readonly AgentMessage[],
  turns: ReadonlyMap<string, readonly AgentMessage[]>,
  openRuns: RoutineRunOpenState,
): AgentMessage[] {
  const placed = new Set<string>();
  for (const row of rows) {
    const marker = routineRunMarker(row);
    for (const message of (marker && turns.get(marker.runId)) ?? []) placed.add(message.id);
  }
  return rows.flatMap((row) => {
    if (placed.has(row.id)) return [];
    const marker = routineRunMarker(row);
    const messages = marker ? turns.get(marker.runId) : undefined;
    if (!marker || !messages?.length) return [row];
    const expanded = openRuns.get(routineRunToggleKey(marker)) ?? routineRunOpenByDefault(marker, messages);
    return [{ ...row, actionMarker: { ...marker, expanded } }, ...(expanded ? messages : [])];
  });
}

function routineRunOpenByDefault(marker: RoutineRunMarker, messages: readonly AgentMessage[]): boolean {
  if (marker.status === "queued" || marker.status === "running" || marker.status === "needs-attention") return true;
  return messages.some((message) => message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE);
}

export function expandRoutineRunGroups(
  rows: readonly AgentMessage[],
  runRows: readonly AgentMessage[],
  turns: ReadonlyMap<string, readonly AgentMessage[]>,
  openRuns: RoutineRunOpenState,
): AgentMessage[] {
  const runRowById = new Map(runRows.map((row) => [row.id, row]));
  return rows.flatMap((row) => {
    const group = row.actionMarker?.kind === "routine-run-group" ? row.actionMarker : null;
    if (!group) return [row];
    const expanded = openRuns.get(routineRunToggleKey(group)) ?? false;
    const groupRow = { ...row, actionMarker: { ...group, expanded } };
    if (!expanded) return [groupRow];
    return [
      groupRow,
      ...group.runs.flatMap(({ id, marker }) => {
        const runRow = runRowById.get(id);
        if (!runRow) return [];
        const { expanded: _expanded, ...runMarker } = marker;
        return [
          { ...runRow, id: routineRunGroupEntryId(id), animate: false, actionMarker: runMarker },
          ...(turns.get(marker.runId) ?? []),
        ];
      }),
    ];
  });
}

function routineRunGroupEntryId(messageId: string): string {
  return `${messageId}:routine-run-group-entry`;
}

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

/**
 * Reduces the durable transition log to one visible summary for each routine run.
 * The stored messages stay unchanged, so the summary can be rebuilt after refresh or pagination.
 *
 * The summary shows the latest state at the place where the run starts. The messages of the run
 * follow that row, so a later state does not move them below turns that came after them (#6118).
 */
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
          // The row keeps the id, time and place of the first state, so it stays the same row while
          // the run changes state, and the day separators match its place.
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
 * its own. An open run also keeps a row of its own, because its messages follow its row. A group also stops at the first unread message and at a new day, so the unread divider
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

/**
 * The open state that the reader chose for a run or a run group, by `routineRunToggleKey`. A run
 * with no entry takes its default, so a run that finishes takes the default of a finished run.
 */
export type RoutineRunOpenState = ReadonlyMap<string, boolean>;

/** The key of a run, or of a group by its first run, in `RoutineRunOpenState`. */
export function routineRunToggleKey(marker: RoutineRunMarker | RoutineRunGroupMarker): string {
  return marker.kind === "routine-run" ? marker.runId : `group:${marker.runs[0]?.marker.runId ?? ""}`;
}

/**
 * The messages of each routine run's turn, by run id. The routine delivery names the run and the
 * turn it started, so each message of that turn belongs to the run. A turn that also runs another
 * delivery, such as a message from a person or a teammate, or a second run, keeps its messages in
 * place: they do not belong to one run.
 */
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

/** A teammate's message. The agent's own message to a teammate is an outgoing exchange. */
function fromTeammate(message: AgentMessage): boolean {
  return message.senderAgentId !== undefined && message.exchange?.direction !== "outgoing";
}

/**
 * Moves the messages of each run's turn to just after the run's row, so they open and close with the
 * run. The row of a run with messages sets `expanded`. A run that is not finished, and a run that
 * reported something, starts open. A finished quiet run, which has only quiet answers, starts closed.
 * A message of a run with no drawn row stays where it is.
 */
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

/**
 * Draws each run of an open group as a row under the group, with the messages of its turn. Use it on
 * rows that `groupRoutineRunMarkers` made from the rows of `placeRoutineRunTurns`. A group starts
 * closed. The group row keeps the id of its first run, so each run row gets an id of its own.
 */
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
        // In an open group, the group row opens and closes the messages of each run.
        const { expanded: _expanded, ...runMarker } = marker;
        return [
          { ...runRow, id: routineRunGroupEntryId(id), animate: false, actionMarker: runMarker },
          ...(turns.get(marker.runId) ?? []),
        ];
      }),
    ];
  });
}

/** The row id of a run inside an open group. The group row has the id of its first run. */
function routineRunGroupEntryId(messageId: string): string {
  return `${messageId}:routine-run-group-entry`;
}

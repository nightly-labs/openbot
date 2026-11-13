import { type ChannelMessage, type ConversationMessage, isAgentAnswer } from "@openbot/contracts/ipc";
import { isTurnThought, type TurnStepLine, type TurnStepLines } from "@/features/workspace/model/turn-step-lines";
import { messageTime } from "./message-time";

export type TurnThinkingStep =
  | { id: string; kind: "thought"; text: string; createdAt: string; streaming: boolean }
  | { id: string; kind: "progress"; text: string };

/** The thoughts of a turn and its progress lines, in the order they came. */
export function turnThinkingSteps(
  messages: readonly ConversationMessage[],
  turnId: string,
  lines: readonly TurnStepLine[] = [],
): TurnThinkingStep[] {
  const thoughts = messages.filter((message) => message.turnId === turnId && isTurnThought(message));
  const known = new Set(thoughts.map((message) => message.id));
  // One pass over the lines: a long turn has many thoughts, and this runs on each streamed frame.
  const byThought = new Map<string | null, TurnThinkingStep[]>();
  for (const line of lines) {
    // A line after a thought that the phone no longer holds goes before the first thought.
    const after = line.after !== null && known.has(line.after) ? line.after : null;
    const group = byThought.get(after) ?? [];
    group.push({ id: line.id, kind: "progress", text: line.text });
    byThought.set(after, group);
  }
  const linesAfter = (id: string | null) => byThought.get(id) ?? [];
  const steps = [...linesAfter(null)];
  for (const message of thoughts) {
    steps.push({
      id: message.id,
      kind: "thought",
      text: message.text.trim(),
      createdAt: message.createdAt,
      streaming: message.status === "streaming",
    });
    steps.push(...linesAfter(message.id));
  }
  return steps;
}

/**
 * True when `messages` hold the start of the turn: a message of another turn comes before its first
 * message. A long turn has more thoughts than one page, so its start can be in an older page.
 */
export function turnStartLoaded(messages: readonly ConversationMessage[], turnId: string): boolean {
  return messages.findIndex((message) => message.turnId === turnId) > 0;
}

/**
 * When the turn started and, for a finished turn, when it ended, in host time. The first message of
 * the turn, the user's, starts it; its first answer, or its last thought, ends it.
 */
export function turnTimes(
  messages: readonly ConversationMessage[],
  turnId: string,
): { startedAt: number; endedAt: number } | null {
  let startedAt = Number.POSITIVE_INFINITY;
  let endedAt = Number.NEGATIVE_INFINITY;
  for (const message of messages) {
    if (message.turnId !== turnId) continue;
    const at = Date.parse(message.createdAt);
    if (!Number.isFinite(at)) continue;
    startedAt = Math.min(startedAt, at);
    if (isAgentAnswer(message) || isTurnThought(message)) endedAt = Math.max(endedAt, at);
  }
  return Number.isFinite(startedAt) ? { startedAt, endedAt: Math.max(startedAt, endedAt) } : null;
}

/** The steps row above a finished answer, or in the place of the answer of a turn with none. */
export interface TurnStepsSummary {
  turnId: string;
  steps: number;
  /** How long the turn took, or null when the host gave no times. */
  seconds: number | null;
}

/** The id of the chat row that holds the thoughts of a turn in an agent chat. */
export function thinkingRowId(turnId: string): string {
  return `thinking:${turnId}`;
}

/**
 * A finished agent message with nothing to draw. An agent ends a turn with no text when it has
 * nothing to tell the user. As on desktop, such a turn shows no steps.
 */
function silentAnswer(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    message.itemType !== "commentary" &&
    message.status === "completed" &&
    !message.text.trim() &&
    !message.attachments?.length &&
    !message.imageGeneration &&
    !message.videoGeneration &&
    !message.questionPrompt
  );
}

interface TurnTally {
  thoughts: number;
  /** The row of the turn's first thought. */
  thoughtRowId: string;
  answerId: string | null;
  silent: boolean;
  startedAt?: number;
  endedAt?: number;
}

/** The thoughts, the first answer and the times of each turn, as `turnTimes` finds them, in one pass. */
function tallyTurns<T>(
  items: readonly T[],
  read: (item: T) => { rowId: string; message: ConversationMessage } | null,
): Map<string, TurnTally> {
  const turns = new Map<string, TurnTally>();
  for (const item of items) {
    const entry = read(item);
    const turnId = entry?.message.turnId;
    if (!entry || !turnId) continue;
    const { message } = entry;
    const thought = isTurnThought(message);
    const answer = !thought && isAgentAnswer(message);
    let turn = turns.get(turnId);
    if (!turn) {
      turn = { thoughts: 0, thoughtRowId: "", answerId: null, silent: false };
      turns.set(turnId, turn);
    }
    if (thought) {
      if (turn.thoughts === 0) turn.thoughtRowId = entry.rowId;
      turn.thoughts += 1;
    } else if (answer) turn.answerId ??= message.id;
    else if (silentAnswer(message)) turn.silent = true;
    const at = messageTime(message.createdAt);
    if (!Number.isFinite(at)) continue;
    turn.startedAt = Math.min(turn.startedAt ?? at, at);
    if (thought || answer) turn.endedAt = Math.max(turn.endedAt ?? at, at);
  }
  return turns;
}

function turnSeconds(turn: TurnTally): number | null {
  const start = turn.startedAt;
  return start === undefined ? null : Math.round((Math.max(start, turn.endedAt ?? 0) - start) / 1000);
}

/**
 * The steps row of each finished turn, by the id of the turn's first answer. A turn with no answer,
 * such as a stopped one, has its row on its thinking row. A turn with no thought and no progress
 * line has none, and so has a turn that ends with no text on purpose. The running turn has none:
 * the activity row opens it. Returns `previous` when no row changed, so a streamed word does not
 * draw every chat row again.
 */
export function finishedTurnSummaries(
  messages: readonly ConversationMessage[],
  activeTurnId: string | null,
  lines: TurnStepLines,
  previous?: ReadonlyMap<string, TurnStepsSummary>,
): ReadonlyMap<string, TurnStepsSummary> {
  const turns = tallyTurns(messages, (message) =>
    message.turnId === activeTurnId ? null : { rowId: message.id, message },
  );
  const summaries = new Map<string, TurnStepsSummary>();
  for (const [turnId, turn] of turns) {
    const steps = turn.thoughts + (lines[turnId]?.length ?? 0);
    if (steps === 0) continue;
    const rowId = turn.answerId ?? (turn.thoughts > 0 && !turn.silent ? thinkingRowId(turnId) : null);
    if (rowId) summaries.set(rowId, { turnId, steps, seconds: turnSeconds(turn) });
  }
  return keptSummaries(summaries, previous);
}

/**
 * The steps row of each finished channel turn with no answer, by the row of its first thought. A
 * channel has no thinking sheet, so a turn with an answer shows only the answer. `running` names
 * the turns that the activity rows show.
 */
export function unansweredChannelTurnSummaries(
  messages: readonly ChannelMessage[],
  running: (turnId: string, agentId: string) => boolean,
  previous?: ReadonlyMap<string, TurnStepsSummary>,
): ReadonlyMap<string, TurnStepsSummary> {
  const authors = new Map<string, string>();
  const turns = tallyTurns(messages, (entry) => {
    if (entry.author.kind !== "agent" || (entry.superseded && entry.message.itemType === "commentary")) return null;
    if (entry.message.turnId) authors.set(entry.message.turnId, entry.author.id);
    return { rowId: entry.id, message: entry.message };
  });
  const summaries = new Map<string, TurnStepsSummary>();
  for (const [turnId, turn] of turns) {
    const agentId = authors.get(turnId);
    if (turn.thoughts === 0 || turn.answerId || turn.silent || !agentId || running(turnId, agentId)) continue;
    summaries.set(turn.thoughtRowId, { turnId, steps: turn.thoughts, seconds: turnSeconds(turn) });
  }
  return keptSummaries(summaries, previous);
}

function keptSummaries(
  summaries: ReadonlyMap<string, TurnStepsSummary>,
  previous: ReadonlyMap<string, TurnStepsSummary> | undefined,
): ReadonlyMap<string, TurnStepsSummary> {
  const same =
    previous?.size === summaries.size &&
    [...summaries].every(([id, summary]) => {
      const kept = previous.get(id);
      return kept?.turnId === summary.turnId && kept.steps === summary.steps && kept.seconds === summary.seconds;
    });
  return same && previous ? previous : summaries;
}

import { type ChannelMessage, type ConversationMessage, isAgentAnswer } from "@openbot/contracts/ipc";
import { isTurnThought, type TurnStepLine, type TurnStepLines } from "@/features/workspace/model/turn-step-lines";
import { messageTime } from "./message-time";

export type TurnThinkingStep =
  | { id: string; kind: "thought"; text: string; createdAt: string; streaming: boolean }
  | { id: string; kind: "progress"; text: string };

export function turnThinkingSteps(
  messages: readonly ConversationMessage[],
  turnId: string,
  lines: readonly TurnStepLine[] = [],
): TurnThinkingStep[] {
  const thoughts = messages.filter((message) => message.turnId === turnId && isTurnThought(message));
  const known = new Set(thoughts.map((message) => message.id));
  const byThought = new Map<string | null, TurnThinkingStep[]>();
  for (const line of lines) {
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

export function turnStartLoaded(messages: readonly ConversationMessage[], turnId: string): boolean {
  return messages.findIndex((message) => message.turnId === turnId) > 0;
}

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

export interface TurnStepsSummary {
  turnId: string;
  steps: number;
  seconds: number | null;
}

export function thinkingRowId(turnId: string): string {
  return `thinking:${turnId}`;
}

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
  thoughtRowId: string;
  answerId: string | null;
  silent: boolean;
  startedAt?: number;
  endedAt?: number;
}

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

export function finishedTurnSummaries(
  messages: readonly ConversationMessage[],
  activeTurnId: string | null,
  lines: TurnStepLines,
  previous?: ReadonlyMap<string, TurnStepsSummary>,
): ReadonlyMap<string, TurnStepsSummary> {
  return turnSummaries(messages, activeTurnId, false, lines, previous);
}

export function chatTurnSummaries(
  messages: readonly ConversationMessage[],
  activeTurnId: string | null,
  lines: TurnStepLines,
  previous?: ReadonlyMap<string, TurnStepsSummary>,
): ReadonlyMap<string, TurnStepsSummary> {
  return turnSummaries(messages, activeTurnId, true, lines, previous);
}

function turnSummaries(
  messages: readonly ConversationMessage[],
  activeTurnId: string | null,
  withLiveAnswer: boolean,
  lines: TurnStepLines,
  previous: ReadonlyMap<string, TurnStepsSummary> | undefined,
): ReadonlyMap<string, TurnStepsSummary> {
  const turns = tallyTurns(messages, (message) =>
    !withLiveAnswer && message.turnId === activeTurnId ? null : { rowId: message.id, message },
  );
  const summaries = new Map<string, TurnStepsSummary>();
  for (const [turnId, turn] of turns) {
    const steps = turn.thoughts + (lines[turnId]?.length ?? 0);
    if (steps === 0) continue;
    if (turnId === activeTurnId) {
      if (turn.answerId) summaries.set(turn.answerId, { turnId, steps, seconds: null });
      continue;
    }
    const rowId = turn.answerId ?? (turn.thoughts > 0 && !turn.silent ? thinkingRowId(turnId) : null);
    if (rowId) summaries.set(rowId, { turnId, steps, seconds: turnSeconds(turn) });
  }
  return keptSummaries(summaries, previous);
}

export function answerlessTurnSummaries(
  summaries: ReadonlyMap<string, TurnStepsSummary> | undefined,
): ReadonlyMap<string, TurnStepsSummary> | undefined {
  if (!summaries) return undefined;
  return new Map([...summaries].filter(([rowId, summary]) => rowId === thinkingRowId(summary.turnId)));
}

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

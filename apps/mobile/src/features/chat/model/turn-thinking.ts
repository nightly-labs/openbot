import { type ConversationMessage, isAgentAnswer } from "@openbot/contracts/ipc";
import { isTurnThought, type TurnStepLine, type TurnStepLines } from "@/features/workspace/model/turn-step-lines";

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
  const linesAfter = (id: string | null) =>
    lines
      // A line after a thought that the phone no longer holds goes before the first thought.
      .filter((line) => (id === null ? line.after === null || !known.has(line.after) : line.after === id))
      .map((line): TurnThinkingStep => ({ id: line.id, kind: "progress", text: line.text }));
  const steps = linesAfter(null);
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

/** The steps row above a finished answer. */
export interface TurnStepsSummary {
  turnId: string;
  steps: number;
  /** How long the turn took, or null when the host gave no times. */
  seconds: number | null;
}

/**
 * The steps row of each finished turn, by the id of the turn's first answer. A turn with no
 * thought and no progress line has none. The running turn has none: the activity row opens it.
 * Returns `previous` when no row changed, so a streamed word does not draw every chat row again.
 */
export function finishedTurnSummaries(
  messages: readonly ConversationMessage[],
  activeTurnId: string | null,
  lines: TurnStepLines,
  previous?: ReadonlyMap<string, TurnStepsSummary>,
): ReadonlyMap<string, TurnStepsSummary> {
  const answers = new Map<string, string>();
  const thoughts = new Map<string, number>();
  // The times of each turn, as `turnTimes` finds them, in the same one pass over the messages.
  const startedAt = new Map<string, number>();
  const endedAt = new Map<string, number>();
  for (const message of messages) {
    const turnId = message.turnId;
    if (!turnId || turnId === activeTurnId) continue;
    const thought = isTurnThought(message);
    const answer = !thought && isAgentAnswer(message);
    if (thought) thoughts.set(turnId, (thoughts.get(turnId) ?? 0) + 1);
    else if (answer && !answers.has(turnId)) answers.set(turnId, message.id);
    const at = Date.parse(message.createdAt);
    if (!Number.isFinite(at)) continue;
    startedAt.set(turnId, Math.min(startedAt.get(turnId) ?? at, at));
    if (thought || answer) endedAt.set(turnId, Math.max(endedAt.get(turnId) ?? at, at));
  }
  const summaries = new Map<string, TurnStepsSummary>();
  for (const [turnId, answerId] of answers) {
    const steps = (thoughts.get(turnId) ?? 0) + (lines[turnId]?.length ?? 0);
    if (steps === 0) continue;
    const start = startedAt.get(turnId);
    const end = Math.max(start ?? 0, endedAt.get(turnId) ?? 0);
    summaries.set(answerId, {
      turnId,
      steps,
      seconds: start === undefined ? null : Math.round((end - start) / 1000),
    });
  }
  const same =
    previous?.size === summaries.size &&
    [...summaries].every(([id, summary]) => {
      const kept = previous.get(id);
      return kept?.turnId === summary.turnId && kept.steps === summary.steps && kept.seconds === summary.seconds;
    });
  return same && previous ? previous : summaries;
}

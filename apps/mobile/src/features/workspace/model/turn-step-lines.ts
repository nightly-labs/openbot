import type { ConversationMessage } from "@openbot/contracts/ipc";

/**
 * A progress line of a turn, such as "Running a command…". The host sends each line once and stores
 * none, so the phone keeps them in memory for its newest turns, as desktop does: after a restart a
 * turn shows only its stored thoughts.
 */
export interface TurnStepLine {
  id: string;
  /** The host's English source text. The sheet renders it with `sourceText`. */
  text: string;
  /**
   * The newest thought of the turn when the line came, or null before the first thought. The line
   * shows after it. The host and phone clocks can differ, so a phone time cannot order a line
   * between host thoughts.
   */
  after: string | null;
}

export type TurnStepLines = Readonly<Record<string, readonly TurnStepLine[]>>;

const TURN_LIMIT = 50;
const LINE_LIMIT = 200;

/** `lines` with `text` added to the turn. A line the same as the turn's last one is not added again. */
export function appendTurnStepLine(
  lines: TurnStepLines,
  turnId: string,
  text: string,
  after: string | null,
): TurnStepLines {
  const turn = lines[turnId] ?? [];
  const last = turn.at(-1);
  if (!text.trim() || last?.text === text) return lines;
  const sequence = last ? Number(last.id.slice(last.id.lastIndexOf(":") + 1)) + 1 : 0;
  // The turn moves to the end, so the limit drops the turns that got no line for the longest time.
  const next: Record<string, readonly TurnStepLine[]> = { ...lines };
  delete next[turnId];
  next[turnId] = [...turn, { id: `${turnId}:${sequence}`, text, after }].slice(-LINE_LIMIT);
  const turns = Object.keys(next);
  for (const old of turns.slice(0, Math.max(0, turns.length - TURN_LIMIT))) delete next[old];
  return next;
}

/** A thought of a turn: the agent's commentary while it works. */
export function isTurnThought(message: ConversationMessage): boolean {
  return message.author === "assistant" && message.itemType === "commentary" && Boolean(message.text.trim());
}

/** The id of the turn's newest thought in `messages`, for a progress line that comes now. */
export function latestThoughtId(messages: readonly ConversationMessage[], turnId: string): string | null {
  return messages.findLast((message) => message.turnId === turnId && isTurnThought(message))?.id ?? null;
}

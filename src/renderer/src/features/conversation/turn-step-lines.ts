/**
 * The host's progress lines of a turn, such as "Gathering the relevant information…", in the order
 * they came. The host sends each line once and stores none, so a window keeps them in memory for its
 * newest turns: after a restart a turn shows only its stored thinking and memory changes.
 */
interface TurnStepLine {
  id: string;
  /** The host's English source text. The chat renders it with `sourceText`. */
  text: string;
  /** When this window received the line, to place it between the turn's thoughts. */
  at: number;
}

export type TurnStepLines = Readonly<Record<string, readonly TurnStepLine[]>>;

const TURN_LIMIT = 50;
const LINE_LIMIT = 200;

/**
 * `lines` with `text` added to the turn. A line the same as the turn's last one is not added again.
 * A line with a `stepId` replaces the earlier line of that tool step, so live output does not grow
 * the list by one line per update.
 */
export function appendTurnStepLine(
  lines: TurnStepLines,
  turnId: string,
  text: string,
  stepId?: string,
  at = Date.now(),
): TurnStepLines {
  const turn = lines[turnId] ?? [];
  if (!text.trim()) return lines;
  const existing = stepId === undefined ? undefined : turn.find((line) => line.id === stepId);
  if (existing) {
    if (existing.text === text) return lines;
    const next: Record<string, readonly TurnStepLine[]> = { ...lines };
    next[turnId] = turn.map((line) => (line.id === stepId ? { ...line, text } : line));
    return next;
  }
  if (turn.at(-1)?.text === text) return lines;
  // A step id can contain colons, so read the sequence from the numeric suffix only.
  const sequence = turn.reduce((next, line) => {
    const match = /:(\d+)$/u.exec(line.id);
    return match ? Math.max(next, Number(match[1]) + 1) : next;
  }, turn.length);
  // The turn moves to the end, so the limit drops the turns that got no line for the longest time,
  // and not a long turn that started first.
  const next: Record<string, readonly TurnStepLine[]> = { ...lines };
  delete next[turnId];
  next[turnId] = [...turn, { id: stepId ?? `${turnId}:${sequence}`, text, at }].slice(-LINE_LIMIT);
  const turns = Object.keys(next);
  for (const old of turns.slice(0, Math.max(0, turns.length - TURN_LIMIT))) delete next[old];
  return next;
}

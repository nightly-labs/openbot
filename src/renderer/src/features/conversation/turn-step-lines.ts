/**
 * The host's progress lines of a turn, such as "Gathering the relevant information…", in the order
 * they came. The host sends each line once and stores none, so a window keeps them in memory for its
 * newest turns: after a restart a turn shows only its stored thinking and memory changes.
 */
interface TurnStepLine {
  id: string;
  /** The host's English source text. The chat renders it with `sourceText`. */
  text: string;
  /** The failed tool's error text, when this line is a failure. The list keeps it collapsed. */
  error?: string;
  /** When this window received the line, to place it between the turn's thoughts. */
  at: number;
}

export type TurnStepLines = Readonly<Record<string, readonly TurnStepLine[]>>;

const TURN_LIMIT = 50;
const LINE_LIMIT = 200;

/** `lines` with `text` added to the turn. A line the same as the turn's last one is not added again. */
export function appendTurnStepLine(
  lines: TurnStepLines,
  turnId: string,
  text: string,
  at = Date.now(),
  error?: string,
): TurnStepLines {
  const turn = lines[turnId] ?? [];
  const last = turn.at(-1);
  const detail = error?.trim() || undefined;
  if (!text.trim() || (last?.text === text && last.error === detail)) return lines;
  const sequence = last ? Number(last.id.slice(last.id.lastIndexOf(":") + 1)) + 1 : 0;
  // The turn moves to the end, so the limit drops the turns that got no line for the longest time,
  // and not a long turn that started first.
  const next: Record<string, readonly TurnStepLine[]> = { ...lines };
  delete next[turnId];
  next[turnId] = [...turn, { id: `${turnId}:${sequence}`, text, ...(detail ? { error: detail } : {}), at }].slice(
    -LINE_LIMIT,
  );
  const turns = Object.keys(next);
  for (const old of turns.slice(0, Math.max(0, turns.length - TURN_LIMIT))) delete next[old];
  return next;
}

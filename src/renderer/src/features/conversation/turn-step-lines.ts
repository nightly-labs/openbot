interface TurnStepLine {
  id: string;
  text: string;
  at: number;
  error?: string | undefined;
}

export type TurnStepLines = Readonly<Record<string, readonly TurnStepLine[]>>;

const TURN_LIMIT = 200;
const LINE_LIMIT = 200;

export function appendTurnStepLine(
  lines: TurnStepLines,
  turnId: string,
  text: string,
  error?: string,
  at = Date.now(),
): TurnStepLines {
  const turn = lines[turnId] ?? [];
  const last = turn.at(-1);
  if (!text.trim() || (last?.text === text && last.error === error)) return lines;
  const sequence = last ? Number(last.id.slice(last.id.lastIndexOf(":") + 1)) + 1 : 0;
  const next: Record<string, readonly TurnStepLine[]> = { ...lines };
  delete next[turnId];
  next[turnId] = [...turn, { id: `${turnId}:${sequence}`, text, at, ...(error ? { error } : {}) }].slice(-LINE_LIMIT);
  const turns = Object.keys(next);
  for (const old of turns.slice(0, Math.max(0, turns.length - TURN_LIMIT))) delete next[old];
  return next;
}
